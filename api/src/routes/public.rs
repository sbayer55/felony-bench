use crate::app::AppState;
use crate::error::{ApiError, ApiResult};
use crate::feed;
use crate::model::Incident;
use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use sha2::{Digest, Sha256};

const CACHE_CONTROL: &str = "public, max-age=60, stale-while-revalidate=600";

pub async fn health(State(s): State<AppState>) -> ApiResult<Json<serde_json::Value>> {
    sqlx::query("SELECT 1").execute(&s.pool).await?;
    Ok(Json(
        serde_json::json!({ "ok": true, "incidents": s.cache.get().data.incidents.len() }),
    ))
}

/// The whole dataset, pre-serialized and pre-compressed. Supports If-None-Match.
pub async fn bootstrap(State(s): State<AppState>, headers: HeaderMap) -> Response {
    let snap = s.cache.get();
    let etag = HeaderValue::from_str(&snap.etag).expect("etag is ascii");
    let base = [
        (header::ETAG, etag.clone()),
        (header::CACHE_CONTROL, HeaderValue::from_static(CACHE_CONTROL)),
    ];
    let vary = (header::VARY, HeaderValue::from_static("accept-encoding"));

    let matches = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.split(',').any(|t| t.trim() == snap.etag || t.trim() == "*"));
    if matches {
        return (StatusCode::NOT_MODIFIED, base, [vary]).into_response();
    }

    let accept = headers.get(header::ACCEPT_ENCODING).and_then(|v| v.to_str().ok()).unwrap_or("");
    let accepts = |enc: &str| {
        accept
            .split(',')
            .any(|e| e.split(';').next().is_some_and(|n| n.trim().eq_ignore_ascii_case(enc)))
    };
    let json = (header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if accepts("br") {
        (
            base,
            [json, vary, (header::CONTENT_ENCODING, HeaderValue::from_static("br"))],
            snap.br.clone(),
        )
            .into_response()
    } else if accepts("gzip") {
        (
            base,
            [json, vary, (header::CONTENT_ENCODING, HeaderValue::from_static("gzip"))],
            snap.gzip.clone(),
        )
            .into_response()
    } else {
        (base, [json, vary], snap.json.clone()).into_response()
    }
}

fn cached<T: serde::Serialize>(v: T) -> Response {
    ([(header::CACHE_CONTROL, CACHE_CONTROL)], Json(v)).into_response()
}

pub async fn providers(State(s): State<AppState>) -> Response {
    cached(&s.cache.get().data.providers)
}

pub async fn models(State(s): State<AppState>) -> Response {
    cached(&s.cache.get().data.models)
}

pub async fn meta(State(s): State<AppState>) -> Response {
    cached(&s.cache.get().data.meta)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncidentFilter {
    category: Option<String>,
    evidence_class: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    since: Option<String>,
    until: Option<String>,
    limit: Option<usize>,
}

impl IncidentFilter {
    fn matches(&self, i: &Incident) -> bool {
        let b = &i.body;
        self.category.as_ref().is_none_or(|c| &b.category == c)
            && self.evidence_class.as_ref().is_none_or(|e| &b.evidence_class == e)
            && self.provider.as_ref().is_none_or(|p| b.provider_ids.contains(p))
            && self.model.as_ref().is_none_or(|m| b.model_ids.contains(m))
            && self.since.as_ref().is_none_or(|d| b.date.as_str() >= d.as_str())
            && self.until.as_ref().is_none_or(|d| b.date.as_str() <= d.as_str())
    }
}

pub async fn incidents(State(s): State<AppState>, Query(f): Query<IncidentFilter>) -> Response {
    let snap = s.cache.get();
    let out: Vec<&Incident> = snap
        .data
        .incidents
        .iter()
        .filter(|i| f.matches(i))
        .take(f.limit.unwrap_or(usize::MAX))
        .collect();
    cached(out)
}

pub async fn incident(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Response> {
    let snap = s.cache.get();
    snap.incident(&id).map(cached).ok_or_else(ApiError::not_found)
}

/// Site origin for absolute feed links: PUBLIC_URL, else the request's Host.
fn public_base(s: &AppState, headers: &HeaderMap) -> String {
    if let Some(url) = &s.config.public_url {
        return url.trim_end_matches('/').to_string();
    }
    let header = |name| headers.get(name).and_then(|v: &HeaderValue| v.to_str().ok());
    let host = header(header::HOST).unwrap_or("localhost");
    let proto = s
        .config
        .trust_proxy
        .then(|| header(HeaderName::from_static("x-forwarded-proto")))
        .flatten()
        .and_then(|p| p.split(',').next())
        .map(str::trim)
        .filter(|p| *p == "https" || *p == "http")
        .unwrap_or("http");
    format!("{proto}://{host}")
}

/// RSS 2.0 feed of the newest incidents. Supports If-None-Match.
pub async fn feed(State(s): State<AppState>, headers: HeaderMap) -> Response {
    let snap = s.cache.get();
    let base = public_base(&s, &headers);
    let tag = Sha256::new().chain_update(&snap.etag).chain_update(&base).finalize();
    let etag = format!("\"rss-{}\"", hex::encode(&tag[..12]));
    let base_headers = [
        (header::ETAG, HeaderValue::from_str(&etag).expect("etag is ascii")),
        (header::CACHE_CONTROL, HeaderValue::from_static(CACHE_CONTROL)),
    ];
    let matches = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.split(',').any(|t| t.trim() == etag || t.trim() == "*"));
    if matches {
        return (StatusCode::NOT_MODIFIED, base_headers).into_response();
    }
    (
        base_headers,
        [(header::CONTENT_TYPE, HeaderValue::from_static("application/rss+xml; charset=utf-8"))],
        feed::render(&snap.data, &base),
    )
        .into_response()
}
