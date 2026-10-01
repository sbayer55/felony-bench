//! End-to-end tests against a real Postgres. `#[sqlx::test]` creates a fresh, migrated database per test from
//! DATABASE_URL (e.g. `docker compose up -d db` and DATABASE_URL=postgres://felony:felony@localhost:5432/felony).

use axum::Router;
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode, header};
use felony_api::app::{AppState, router};
use felony_api::cache::Cache;
use felony_api::config::Config;
use felony_api::enums::ENUMS;
use felony_api::model::Data;
use felony_api::pipeline::SourceChecker;
use felony_api::{repo, seed};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::future::Future;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use tower::ServiceExt;

const TOKEN: &str = "test-admin-token-0123456789";

struct Reachable;
impl SourceChecker for Reachable {
    fn reachable<'a>(&'a self, _: &'a [String]) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async { Ok(()) })
    }
}

fn seed_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../data/seed")
}

async fn app(pool: &PgPool, seeded: bool) -> Router {
    if seeded {
        seed::import(pool, &seed_dir()).await.unwrap();
    }
    let cache = Cache::new(repo::load_all(pool).await.unwrap());
    router(AppState::new(pool.clone(), cache, Config::for_tests(), Arc::new(Reachable)))
}

struct Res {
    status: StatusCode,
    headers: axum::http::HeaderMap,
    body: Vec<u8>,
}

impl Res {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
}

async fn send(app: &Router, method: &str, uri: &str, body: Option<Value>, headers: &[(&str, &str)], ip: &str) -> Res {
    let mut req = Request::builder().method(method).uri(uri);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let mut req = match body {
        Some(b) => req
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(b.to_string()))
            .unwrap(),
        None => req.body(Body::empty()).unwrap(),
    };
    req.extensions_mut()
        .insert(ConnectInfo(format!("{ip}:1234").parse::<SocketAddr>().unwrap()));
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let headers = res.headers().clone();
    let body = res.into_body().collect().await.unwrap().to_bytes().to_vec();
    Res { status, headers, body }
}

async fn get(app: &Router, uri: &str) -> Res {
    send(app, "GET", uri, None, &[], "10.0.0.1").await
}

fn auth() -> [(&'static str, String); 1] {
    [("authorization", format!("Bearer {TOKEN}"))]
}

async fn admin(app: &Router, method: &str, uri: &str, body: Option<Value>) -> Res {
    let h = auth();
    send(app, method, uri, body, &[(h[0].0, h[0].1.as_str())], "10.0.0.9").await
}

fn incident(title: &str, url: &str) -> Value {
    json!({
        "date": "2026-09-01",
        "title": title,
        "summary": "According to the court order, the filing cited cases that do not exist.",
        "modelIds": ["chatgpt"],
        "providerIds": ["openai"],
        "category": "fabrication",
        "degree": 1,
        "evidenceClass": "litigation",
        "role": "instrument",
        "attributionConfidence": "confirmed",
        "sources": [{ "title": "Order", "url": url, "publisher": "Court", "date": "2026-09-01" }]
    })
}

async fn submit(app: &Router, inc: Value, ip: &str) -> Res {
    send(
        app,
        "POST",
        "/api/submissions",
        Some(json!({ "incident": inc, "note": "found it" })),
        &[],
        ip,
    )
    .await
}

#[sqlx::test(migrations = "./migrations")]
async fn bootstrap_round_trips_the_seed(pool: PgPool) {
    let app = app(&pool, true).await;
    let (providers, models, incidents) = seed::read_dir(&seed_dir()).unwrap();

    let res = get(&app, "/api/bootstrap").await;
    assert_eq!(res.status, StatusCode::OK);
    let data: Data = serde_json::from_slice(&res.body).unwrap();
    assert_eq!(data.providers, providers);
    assert_eq!(data.models, models);
    assert_eq!(data.incidents, incidents);
    assert_eq!(data.meta.last_refreshed, None);

    let etag = res.headers[header::ETAG].to_str().unwrap().to_string();
    let not_modified = send(&app, "GET", "/api/bootstrap", None, &[("if-none-match", &etag)], "10.0.0.1").await;
    assert_eq!(not_modified.status, StatusCode::NOT_MODIFIED);
    assert!(not_modified.body.is_empty());

    let gz = send(
        &app,
        "GET",
        "/api/bootstrap",
        None,
        &[("accept-encoding", "gzip, deflate")],
        "10.0.0.1",
    )
    .await;
    assert_eq!(gz.headers[header::CONTENT_ENCODING], "gzip");
    assert!(gz.body.len() < res.body.len() / 2);
    let br = send(&app, "GET", "/api/bootstrap", None, &[("accept-encoding", "gzip, br")], "10.0.0.1").await;
    assert_eq!(br.headers[header::CONTENT_ENCODING], "br");
}

#[sqlx::test(migrations = "./migrations")]
async fn incident_reads_and_filters(pool: PgPool) {
    let app = app(&pool, true).await;
    let all = get(&app, "/api/incidents").await.json();
    let first_id = all[0]["id"].as_str().unwrap().to_string();

    let one = get(&app, &format!("/api/incidents/{first_id}")).await;
    assert_eq!(one.status, StatusCode::OK);
    assert_eq!(one.json()["id"], first_id);
    assert_eq!(get(&app, "/api/incidents/nope").await.status, StatusCode::NOT_FOUND);
    assert_eq!(get(&app, "/api/nope").await.status, StatusCode::NOT_FOUND);

    let evals = get(&app, "/api/incidents?evidenceClass=evaluation&provider=anthropic").await.json();
    let evals = evals.as_array().unwrap();
    assert!(!evals.is_empty());
    assert!(
        evals
            .iter()
            .all(|i| i["evidenceClass"] == "evaluation" && i["providerIds"].as_array().unwrap().contains(&json!("anthropic")))
    );
    assert_eq!(get(&app, "/api/incidents?limit=3").await.json().as_array().unwrap().len(), 3);
    assert_eq!(get(&app, "/api/health").await.status, StatusCode::OK);
}

#[sqlx::test(migrations = "./migrations")]
async fn submissions_validate_honeypot_and_rate_limit(pool: PgPool) {
    let app = app(&pool, true).await;

    let ok = submit(
        &app,
        incident("Lawyer sanctioned over invented citations", "https://court.example/a"),
        "10.1.0.1",
    )
    .await;
    assert_eq!(ok.status, StatusCode::CREATED, "{:?}", ok.json());
    assert_eq!(ok.json()["status"], "pending");

    let mut bad = incident("x", "http://insecure.example");
    bad["degree"] = json!(7);
    let bad = submit(&app, bad, "10.1.0.2").await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    let issues = bad.json()["issues"].to_string();
    assert!(issues.contains("degree") && issues.contains("sources.0.url"), "{issues}");

    let bot = send(
        &app,
        "POST",
        "/api/submissions",
        Some(json!({ "incident": incident("Spam", "https://spam.example"), "website": "https://spam.example" })),
        &[],
        "10.1.0.3",
    )
    .await;
    assert_eq!(bot.status, StatusCode::ACCEPTED);

    let pending = admin(&app, "GET", "/api/admin/submissions", None).await.json();
    assert_eq!(
        pending.as_array().unwrap().len(),
        1,
        "honeypot and invalid submissions are not stored"
    );
    assert_eq!(pending[0]["note"], "found it");
    assert!(pending[0].get("ipHash").is_none());

    for n in 0..5 {
        let r = submit(
            &app,
            incident(&format!("Burst {n}"), &format!("https://burst.example/{n}")),
            "10.2.0.1",
        )
        .await;
        assert_eq!(r.status, StatusCode::CREATED);
    }
    let limited = submit(&app, incident("Burst 6", "https://burst.example/6"), "10.2.0.1").await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
    let other_ip = submit(&app, incident("Other", "https://burst.example/7"), "10.2.0.2").await;
    assert_eq!(other_ip.status, StatusCode::CREATED);
}

#[sqlx::test(migrations = "./migrations")]
async fn admin_requires_token(pool: PgPool) {
    let app = app(&pool, false).await;
    assert_eq!(get(&app, "/api/admin/submissions").await.status, StatusCode::UNAUTHORIZED);
    let wrong = send(
        &app,
        "GET",
        "/api/admin/submissions",
        None,
        &[("authorization", "Bearer nope")],
        "10.0.0.1",
    )
    .await;
    assert_eq!(wrong.status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        admin(&app, "GET", "/api/admin/submissions?status=weird", None).await.status,
        StatusCode::BAD_REQUEST
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn approve_publishes_and_reject_records(pool: PgPool) {
    let app = app(&pool, true).await;
    let before = get(&app, "/api/bootstrap").await.json()["incidents"].as_array().unwrap().len();

    let id = submit(
        &app,
        incident("Attorney fined for AI-invented case law", "https://court.example/b"),
        "10.3.0.1",
    )
    .await
    .json()["id"]
        .as_str()
        .unwrap()
        .to_string();
    // Edit-then-approve: the corrected body wins.
    let mut fixed = incident("Attorney fined for AI-invented case law in Ohio", "https://court.example/b");
    fixed["tags"] = json!(["sanctions"]);
    let res = admin(
        &app,
        "POST",
        &format!("/api/admin/submissions/{id}/approve"),
        Some(json!({ "incident": fixed })),
    )
    .await;
    assert_eq!(res.status, StatusCode::OK, "{:?}", res.json());
    let new_id = res.json()["incident"]["id"].as_str().unwrap().to_string();
    assert_eq!(new_id, "2026-09-01-attorney-fined-for-ai-invented-case-law-in-ohio");

    let data = get(&app, "/api/bootstrap").await.json();
    assert_eq!(data["incidents"].as_array().unwrap().len(), before + 1);
    assert_eq!(
        get(&app, &format!("/api/incidents/{new_id}")).await.json()["tags"],
        json!(["sanctions"])
    );

    let again = admin(&app, "POST", &format!("/api/admin/submissions/{id}/approve"), None).await;
    assert_eq!(again.status, StatusCode::CONFLICT);
    let approved = admin(&app, "GET", "/api/admin/submissions?status=approved", None).await.json();
    assert_eq!(approved[0]["incidentId"], new_id);

    // Same source as the incident just published: the pipeline rejects it and it stays pending.
    let dupe = submit(
        &app,
        incident("Different words entirely", "https://www.court.example/b/"),
        "10.3.0.2",
    )
    .await
    .json()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let res = admin(&app, "POST", &format!("/api/admin/submissions/{dupe}/approve"), None).await;
    assert_eq!(res.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(res.json()["reason"].as_str().unwrap().contains(&format!("duplicate of {new_id}")));

    let no_note = admin(
        &app,
        "POST",
        &format!("/api/admin/submissions/{dupe}/reject"),
        Some(json!({ "note": "  " })),
    )
    .await;
    assert_eq!(no_note.status, StatusCode::BAD_REQUEST);
    let rejected = admin(
        &app,
        "POST",
        &format!("/api/admin/submissions/{dupe}/reject"),
        Some(json!({ "note": "Duplicate." })),
    )
    .await;
    assert_eq!(rejected.status, StatusCode::OK);
    assert_eq!(rejected.json()["status"], "rejected");
    assert_eq!(rejected.json()["reviewNote"], "Duplicate.");
    assert_eq!(
        admin(
            &app,
            "POST",
            "/api/admin/submissions/not-a-uuid/reject",
            Some(json!({ "note": "x" }))
        )
        .await
        .status,
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn approve_adds_candidate_models(pool: PgPool) {
    let app = app(&pool, true).await;
    let mut inc = incident("New model leaks credentials in agent run", "https://lab.example/report");
    inc["modelIds"] = json!(["gpt-9-test"]);
    let body = json!({ "incident": inc, "candidateModels": [{ "id": "gpt-9-test", "name": "GPT-9 Test", "providerId": "openai" }] });
    let id = send(&app, "POST", "/api/submissions", Some(body), &[], "10.4.0.1").await.json()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let res = admin(&app, "POST", &format!("/api/admin/submissions/{id}/approve"), None).await;
    assert_eq!(res.status, StatusCode::OK, "{:?}", res.json());
    let models = get(&app, "/api/models").await.json();
    assert!(
        models
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["id"] == "gpt-9-test" && m["providerId"] == "openai")
    );
}

/// The CHECK constraints in the migration must accept exactly the values in shared/enums.json.
#[sqlx::test(migrations = "./migrations")]
async fn db_enums_match_shared_enums(pool: PgPool) {
    async fn accepts(pool: &PgPool, column: &str, value: &str) -> bool {
        let mut tx = pool.begin().await.unwrap();
        let mut row = [
            ("category", "other".to_string()),
            ("evidence_class", "production".to_string()),
            ("role", "actor".to_string()),
            ("attribution_confidence", "reported".to_string()),
        ];
        for (c, v) in row.iter_mut() {
            if *c == column {
                *v = value.to_string();
            }
        }
        let r = sqlx::query(
            "INSERT INTO incidents (id, date, title, summary, degree, category, evidence_class, role, attribution_confidence)
             VALUES ('x', '2026-01-01', 't', 's', 1, $1, $2, $3, $4)",
        )
        .bind(&row[0].1)
        .bind(&row[1].1)
        .bind(&row[2].1)
        .bind(&row[3].1)
        .execute(&mut *tx)
        .await;
        tx.rollback().await.unwrap();
        r.is_ok()
    }
    for (column, values) in [
        ("category", &ENUMS.categories),
        ("evidence_class", &ENUMS.evidence_classes),
        ("role", &ENUMS.roles),
        ("attribution_confidence", &ENUMS.attribution),
    ] {
        for v in values {
            assert!(accepts(&pool, column, v).await, "{column} should accept {v}");
        }
        assert!(
            !accepts(&pool, column, "not-a-value").await,
            "{column} should reject unknown values"
        );
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn integrity_triggers_reject_orphans(pool: PgPool) {
    seed::import(&pool, &seed_dir()).await.unwrap();
    // An incident with no providers or sources fails at commit.
    let mut tx = pool.begin().await.unwrap();
    sqlx::query(
        "INSERT INTO incidents (id, date, title, summary, degree, category, evidence_class, role, attribution_confidence)
         VALUES ('orphan', '2026-01-01', 't', 's', 1, 'other', 'production', 'actor', 'reported')",
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    assert!(tx.commit().await.is_err());

    // A model whose provider is not listed on the incident fails at commit.
    let mut tx = pool.begin().await.unwrap();
    let id: String = sqlx::query_scalar(
        "SELECT incident_id FROM incident_providers WHERE provider_id = 'anthropic'
         AND incident_id NOT IN (SELECT incident_id FROM incident_providers WHERE provider_id = 'openai') LIMIT 1",
    )
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    sqlx::query("INSERT INTO incident_models (incident_id, model_id, position) VALUES ($1, 'chatgpt', 99)")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .unwrap();
    assert!(tx.commit().await.is_err());
}
