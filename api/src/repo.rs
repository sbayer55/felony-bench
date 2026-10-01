//! All SQL lives here.

use crate::model::{CandidateModel, Data, Incident, IncidentBody, Meta, Model, Provider, Source};
use serde::Serialize;
use sqlx::{PgConnection, PgPool, Row};
use uuid::Uuid;

pub const CHANGED_CHANNEL: &str = "data_changed";

pub async fn load_all(pool: &PgPool) -> sqlx::Result<Data> {
    let mut conn = pool.acquire().await?;
    let providers = sqlx::query_as::<_, Provider>("SELECT id, name, url, country, founded FROM providers ORDER BY seq")
        .fetch_all(&mut *conn)
        .await?;
    let models = sqlx::query_as::<_, Model>(
        "SELECT id, name, provider_id, family, to_char(released, 'YYYY-MM-DD') AS released, aliases FROM models ORDER BY seq",
    )
    .fetch_all(&mut *conn)
    .await?;
    let incidents = load_incidents(&mut conn).await?;
    let meta = load_meta(&mut conn).await?;
    Ok(Data {
        providers,
        models,
        incidents,
        meta,
    })
}

async fn load_incidents(conn: &mut PgConnection) -> sqlx::Result<Vec<Incident>> {
    let rows = sqlx::query(
        r#"
        SELECT i.id, to_char(i.date, 'YYYY-MM-DD') AS date, i.title, i.summary, i.category, i.degree, i.evidence_class,
               i.role, i.attribution_confidence, i.tags,
               COALESCE((SELECT array_agg(model_id ORDER BY position) FROM incident_models WHERE incident_id = i.id), '{}') AS model_ids,
               COALESCE((SELECT array_agg(provider_id ORDER BY position) FROM incident_providers WHERE incident_id = i.id), '{}') AS provider_ids,
               COALESCE((SELECT json_agg(json_build_object('title', title, 'url', url, 'publisher', publisher,
                                                           'date', to_char(date, 'YYYY-MM-DD')) ORDER BY position)
                         FROM incident_sources WHERE incident_id = i.id), '[]') AS sources
        FROM incidents i
        ORDER BY i.date DESC, i.id COLLATE "C"
        "#,
    )
    .fetch_all(conn)
    .await?;

    rows.into_iter()
        .map(|r| {
            let sources: sqlx::types::Json<Vec<Source>> = r.try_get("sources")?;
            let degree: i16 = r.try_get("degree")?;
            Ok(Incident {
                id: r.try_get("id")?,
                body: IncidentBody {
                    date: r.try_get("date")?,
                    title: r.try_get("title")?,
                    summary: r.try_get("summary")?,
                    model_ids: r.try_get("model_ids")?,
                    provider_ids: r.try_get("provider_ids")?,
                    category: r.try_get("category")?,
                    degree: degree as u8,
                    evidence_class: r.try_get("evidence_class")?,
                    role: r.try_get("role")?,
                    attribution_confidence: r.try_get("attribution_confidence")?,
                    sources: sources.0,
                    tags: r.try_get("tags")?,
                },
            })
        })
        .collect()
}

async fn load_meta(conn: &mut PgConnection) -> sqlx::Result<Meta> {
    let row = sqlx::query(
        r#"SELECT to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at, added, rejected, gh_run_id
           FROM refresh_runs ORDER BY id DESC LIMIT 1"#,
    )
    .fetch_optional(conn)
    .await?;
    Ok(match row {
        Some(r) => Meta {
            last_refreshed: r.try_get("at")?,
            last_run_added: r.try_get::<i32, _>("added")? as i64,
            last_run_rejected: r.try_get::<i32, _>("rejected")? as i64,
            run_id: r.try_get("gh_run_id")?,
        },
        None => Meta::default(),
    })
}

/// Returns false when the id already exists (seeding is idempotent).
pub async fn insert_provider(conn: &mut PgConnection, p: &Provider) -> sqlx::Result<bool> {
    let r = sqlx::query("INSERT INTO providers (id, name, url, country, founded) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING")
        .bind(&p.id)
        .bind(&p.name)
        .bind(&p.url)
        .bind(&p.country)
        .bind(p.founded)
        .execute(conn)
        .await?;
    Ok(r.rows_affected() == 1)
}

pub async fn insert_model(conn: &mut PgConnection, m: &Model) -> sqlx::Result<bool> {
    let r = sqlx::query(
        "INSERT INTO models (id, name, provider_id, family, released, aliases) VALUES ($1, $2, $3, $4, $5::date, $6) ON CONFLICT (id) DO NOTHING",
    )
    .bind(&m.id)
    .bind(&m.name)
    .bind(&m.provider_id)
    .bind(&m.family)
    .bind(&m.released)
    .bind(&m.aliases)
    .execute(conn)
    .await?;
    Ok(r.rows_affected() == 1)
}

pub async fn insert_incident(conn: &mut PgConnection, inc: &Incident) -> sqlx::Result<bool> {
    let b = &inc.body;
    let r = sqlx::query(
        "INSERT INTO incidents (id, date, title, summary, category, degree, evidence_class, role, attribution_confidence, tags)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING",
    )
    .bind(&inc.id)
    .bind(&b.date)
    .bind(&b.title)
    .bind(&b.summary)
    .bind(&b.category)
    .bind(b.degree as i16)
    .bind(&b.evidence_class)
    .bind(&b.role)
    .bind(&b.attribution_confidence)
    .bind(&b.tags)
    .execute(&mut *conn)
    .await?;
    if r.rows_affected() == 0 {
        return Ok(false);
    }
    sqlx::query("INSERT INTO incident_providers (incident_id, provider_id, position) SELECT $1, p, n - 1 FROM unnest($2::text[]) WITH ORDINALITY AS t(p, n)")
        .bind(&inc.id)
        .bind(&b.provider_ids)
        .execute(&mut *conn)
        .await?;
    sqlx::query("INSERT INTO incident_models (incident_id, model_id, position) SELECT $1, m, n - 1 FROM unnest($2::text[]) WITH ORDINALITY AS t(m, n)")
        .bind(&inc.id)
        .bind(&b.model_ids)
        .execute(&mut *conn)
        .await?;
    let col = |f: fn(&Source) -> &String| b.sources.iter().map(f).cloned().collect::<Vec<_>>();
    let (titles, urls, publishers, dates) = (col(|s| &s.title), col(|s| &s.url), col(|s| &s.publisher), col(|s| &s.date));
    sqlx::query(
        "INSERT INTO incident_sources (incident_id, position, title, url, publisher, date)
         SELECT $1, n - 1, t, u, p, d::date FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) WITH ORDINALITY AS s(t, u, p, d, n)",
    )
    .bind(&inc.id)
    .bind(titles)
    .bind(urls)
    .bind(publishers)
    .bind(dates)
    .execute(conn)
    .await?;
    Ok(true)
}

pub async fn notify_changed(conn: &mut PgConnection) -> sqlx::Result<()> {
    sqlx::query("SELECT pg_notify($1, '')").bind(CHANGED_CHANNEL).execute(conn).await?;
    Ok(())
}

// ---- submissions ----

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Submission {
    pub id: Uuid,
    pub status: String,
    pub incident: serde_json::Value,
    pub candidate_models: serde_json::Value,
    pub note: Option<String>,
    pub contact: Option<String>,
    pub created_at: String,
    pub reviewed_at: Option<String>,
    pub review_note: Option<String>,
    pub incident_id: Option<String>,
}

// A macro rather than a const so queries stay `&'static str` (sqlx rejects runtime-built SQL).
macro_rules! submission_columns {
    () => {
        r#"id, status, payload, candidate_models, note, contact,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
    to_char(reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS reviewed_at,
    review_note, incident_id"#
    };
}

fn submission_from_row(r: &sqlx::postgres::PgRow) -> sqlx::Result<Submission> {
    Ok(Submission {
        id: r.try_get("id")?,
        status: r.try_get("status")?,
        incident: r.try_get("payload")?,
        candidate_models: r.try_get("candidate_models")?,
        note: r.try_get("note")?,
        contact: r.try_get("contact")?,
        created_at: r.try_get("created_at")?,
        reviewed_at: r.try_get("reviewed_at")?,
        review_note: r.try_get("review_note")?,
        incident_id: r.try_get("incident_id")?,
    })
}

pub struct NewSubmission<'a> {
    pub incident: &'a IncidentBody,
    pub candidate_models: &'a [CandidateModel],
    pub note: Option<&'a str>,
    pub contact: Option<&'a str>,
    pub ip_hash: &'a str,
}

pub async fn insert_submission(pool: &PgPool, s: NewSubmission<'_>) -> sqlx::Result<Uuid> {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO submissions (id, payload, candidate_models, note, contact, ip_hash) VALUES ($1, $2, $3, $4, $5, $6)")
        .bind(id)
        .bind(sqlx::types::Json(s.incident))
        .bind(sqlx::types::Json(s.candidate_models))
        .bind(s.note)
        .bind(s.contact)
        .bind(s.ip_hash)
        .execute(pool)
        .await?;
    Ok(id)
}

pub async fn list_submissions(pool: &PgPool, status: &str, limit: i64) -> sqlx::Result<Vec<Submission>> {
    let rows = sqlx::query(concat!(
        "SELECT ",
        submission_columns!(),
        " FROM submissions WHERE status = $1 ORDER BY created_at DESC LIMIT $2"
    ))
    .bind(status)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    rows.iter().map(submission_from_row).collect()
}

/// Locks the row for the rest of the transaction.
pub async fn lock_submission(conn: &mut PgConnection, id: Uuid) -> sqlx::Result<Option<Submission>> {
    let row = sqlx::query(concat!(
        "SELECT ",
        submission_columns!(),
        " FROM submissions WHERE id = $1 FOR UPDATE"
    ))
    .bind(id)
    .fetch_optional(conn)
    .await?;
    row.as_ref().map(submission_from_row).transpose()
}

pub async fn mark_approved(conn: &mut PgConnection, id: Uuid, approved: &IncidentBody, incident_id: &str) -> sqlx::Result<()> {
    sqlx::query("UPDATE submissions SET status = 'approved', reviewed_at = now(), payload = $2, incident_id = $3 WHERE id = $1")
        .bind(id)
        .bind(sqlx::types::Json(approved))
        .bind(incident_id)
        .execute(conn)
        .await?;
    Ok(())
}

pub async fn mark_rejected(conn: &mut PgConnection, id: Uuid, note: &str) -> sqlx::Result<Submission> {
    let row = sqlx::query(concat!(
        "UPDATE submissions SET status = 'rejected', reviewed_at = now(), review_note = $2 WHERE id = $1 RETURNING ",
        submission_columns!()
    ))
    .bind(id)
    .bind(note)
    .fetch_one(conn)
    .await?;
    submission_from_row(&row)
}
