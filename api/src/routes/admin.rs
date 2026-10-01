use crate::app::AppState;
use crate::error::{ApiError, ApiResult};
use crate::model::{CandidateModel, IncidentBody};
use crate::pipeline;
use crate::repo::{self, Submission};
use axum::Json;
use axum::body::Bytes;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, Query, Request, State};
use axum::http::{StatusCode, header};
use axum::middleware::Next;
use axum::response::Response;
use serde::Deserialize;
use serde_json::json;
use subtle::ConstantTimeEq;
use uuid::Uuid;

pub async fn require_token(State(s): State<AppState>, req: Request, next: Next) -> Result<Response, ApiError> {
    let presented = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim);
    let ok = match (s.config.admin_token.as_deref(), presented) {
        (Some(want), Some(got)) if !want.is_empty() => bool::from(want.as_bytes().ct_eq(got.as_bytes())),
        _ => false,
    };
    if !ok {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "unauthorized"));
    }
    Ok(next.run(req).await)
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    status: Option<String>,
    limit: Option<i64>,
}

pub async fn list(State(s): State<AppState>, Query(q): Query<ListQuery>) -> ApiResult<Json<Vec<Submission>>> {
    let status = q.status.as_deref().unwrap_or("pending");
    if !["pending", "approved", "rejected"].contains(&status) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "status must be pending, approved or rejected",
        ));
    }
    let limit = q.limit.unwrap_or(100).clamp(1, 500);
    Ok(Json(repo::list_submissions(&s.pool, status, limit).await?))
}

fn parse_id(id: &str) -> ApiResult<Uuid> {
    Uuid::parse_str(id).map_err(|_| ApiError::not_found())
}

#[derive(Debug, Deserialize, Default)]
struct ApproveRequest {
    /// A corrected version of the submitted incident. The original is used when absent.
    incident: Option<serde_json::Value>,
}

pub async fn approve(State(s): State<AppState>, Path(id): Path<String>, body: Bytes) -> ApiResult<Json<serde_json::Value>> {
    let id = parse_id(&id)?;
    let req: ApproveRequest = if body.iter().all(u8::is_ascii_whitespace) {
        ApproveRequest::default()
    } else {
        serde_json::from_slice(&body).map_err(|e| ApiError::invalid(vec![e.to_string()]))?
    };

    let mut tx = s.pool.begin().await?;
    let sub = repo::lock_submission(&mut tx, id).await?.ok_or_else(ApiError::not_found)?;
    if sub.status != "pending" {
        return Err(ApiError::new(StatusCode::CONFLICT, format!("submission is already {}", sub.status)));
    }
    let raw = req.incident.unwrap_or(sub.incident);
    let body: IncidentBody = serde_json::from_value(raw).map_err(|e| ApiError::invalid(vec![format!("incident: {e}")]))?;
    let candidates: Vec<CandidateModel> = serde_json::from_value(sub.candidate_models).unwrap_or_default();

    let snap = s.cache.get();
    let today = chrono::Utc::now().date_naive().format("%Y-%m-%d").to_string();
    let accepted = pipeline::run(body.clone(), &candidates, &snap.data, &today, s.checker.as_ref())
        .await
        .map_err(|reason| ApiError {
            reason: Some(reason),
            ..ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "rejected by pipeline")
        })?;

    for m in &accepted.new_models {
        repo::insert_model(&mut tx, m).await?;
    }
    if !repo::insert_incident(&mut tx, &accepted.incident).await? {
        return Err(ApiError {
            reason: Some(format!("incident id {} already exists", accepted.incident.id)),
            ..ApiError::new(StatusCode::CONFLICT, "conflict")
        });
    }
    repo::mark_approved(&mut tx, id, &accepted.incident.body, &accepted.incident.id).await?;
    repo::notify_changed(&mut tx).await?;
    tx.commit().await?;
    s.cache.reload(&s.pool).await?;
    tracing::info!(%id, incident = %accepted.incident.id, "submission approved");
    Ok(Json(json!({ "incident": accepted.incident })))
}

#[derive(Debug, Deserialize)]
pub struct RejectRequest {
    note: String,
}

pub async fn reject(
    State(s): State<AppState>,
    Path(id): Path<String>,
    body: Result<Json<RejectRequest>, JsonRejection>,
) -> ApiResult<Json<Submission>> {
    let id = parse_id(&id)?;
    let Json(req) = body.map_err(|e| ApiError::invalid(vec![e.body_text()]))?;
    let note = req.note.trim();
    if note.is_empty() || note.chars().count() > 2000 {
        return Err(ApiError::invalid(vec!["note: 1 to 2000 characters".into()]));
    }
    let mut tx = s.pool.begin().await?;
    let sub = repo::lock_submission(&mut tx, id).await?.ok_or_else(ApiError::not_found)?;
    if sub.status != "pending" {
        return Err(ApiError::new(StatusCode::CONFLICT, format!("submission is already {}", sub.status)));
    }
    let updated = repo::mark_rejected(&mut tx, id, note).await?;
    tx.commit().await?;
    Ok(Json(updated))
}
