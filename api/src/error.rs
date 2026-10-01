use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// JSON error: `{ error, issues?, reason? }`.
#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub error: String,
    pub issues: Option<Vec<String>>,
    pub reason: Option<String>,
}

impl ApiError {
    pub fn new(status: StatusCode, error: impl Into<String>) -> Self {
        Self {
            status,
            error: error.into(),
            issues: None,
            reason: None,
        }
    }
    pub fn invalid(issues: Vec<String>) -> Self {
        Self {
            issues: Some(issues),
            ..Self::new(StatusCode::BAD_REQUEST, "invalid submission")
        }
    }
    pub fn not_found() -> Self {
        Self::new(StatusCode::NOT_FOUND, "not found")
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut body = json!({ "error": self.error });
        if let Some(i) = self.issues {
            body["issues"] = json!(i);
        }
        if let Some(r) = self.reason {
            body["reason"] = json!(r);
        }
        (self.status, Json(body)).into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        tracing::error!(error = %e, "database error");
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal error")
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
