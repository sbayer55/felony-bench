use crate::app::AppState;
use crate::error::{ApiError, ApiResult};
use crate::limit::client_ip;
use crate::model::{CandidateModel, IncidentBody};
use crate::repo::{self, NewSubmission};
use crate::validate;
use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode};
use axum::{Extension, response::IntoResponse};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitRequest {
    incident: serde_json::Value,
    #[serde(default)]
    candidate_models: Vec<CandidateModel>,
    note: Option<String>,
    contact: Option<String>,
    /// Honeypot. Hidden from people; bots fill it in.
    website: Option<String>,
}

fn trimmed(s: &Option<String>) -> Option<&str> {
    s.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

pub async fn create(
    State(s): State<AppState>,
    headers: HeaderMap,
    peer: Option<Extension<ConnectInfo<SocketAddr>>>,
    body: Result<Json<SubmitRequest>, JsonRejection>,
) -> ApiResult<impl IntoResponse> {
    let ip =
        client_ip(&headers, peer.map(|Extension(ConnectInfo(a))| a), s.config.trust_proxy).unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    if !s.limiter.check(ip) {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "too many submissions; try again later",
        ));
    }
    let Json(req) = body.map_err(|e| ApiError::invalid(vec![e.body_text()]))?;

    if trimmed(&req.website).is_some() {
        // Looks like success to the bot; nothing is stored.
        return Ok((
            StatusCode::ACCEPTED,
            Json(json!({ "id": uuid::Uuid::new_v4(), "status": "pending" })),
        ));
    }

    let incident: IncidentBody = serde_json::from_value(req.incident).map_err(|e| ApiError::invalid(vec![format!("incident: {e}")]))?;
    let mut issues = validate::incident_body(&incident);
    issues.extend(validate::candidate_models(&req.candidate_models));
    let (note, contact) = (trimmed(&req.note), trimmed(&req.contact));
    if note.is_some_and(|n| n.chars().count() > 2000) {
        issues.push("note: must be at most 2000 characters".into());
    }
    if contact.is_some_and(|c| c.chars().count() > 200) {
        issues.push("contact: must be at most 200 characters".into());
    }
    if !issues.is_empty() {
        return Err(ApiError::invalid(issues));
    }

    let ip_hash = hex::encode(Sha256::digest(format!("{}:{ip}", s.config.ip_salt)));
    let id = repo::insert_submission(
        &s.pool,
        NewSubmission {
            incident: &incident,
            candidate_models: &req.candidate_models,
            note,
            contact,
            ip_hash: &ip_hash,
        },
    )
    .await?;
    tracing::info!(%id, title = %incident.title, "submission received");
    Ok((StatusCode::CREATED, Json(json!({ "id": id, "status": "pending" }))))
}
