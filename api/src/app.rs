use crate::cache::Cache;
use crate::config::Config;
use crate::error::ApiError;
use crate::limit::RateLimiter;
use crate::pipeline::SourceChecker;
use crate::routes::{admin, public, submit};
use axum::extract::DefaultBodyLimit;
use axum::http::{HeaderName, HeaderValue, Method, header};
use axum::routing::{get, post};
use axum::{Router, middleware};
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub cache: Cache,
    pub config: Arc<Config>,
    pub limiter: Arc<RateLimiter>,
    pub checker: Arc<dyn SourceChecker>,
}

impl AppState {
    pub fn new(pool: PgPool, cache: Cache, config: Config, checker: Arc<dyn SourceChecker>) -> Self {
        let limiter = Arc::new(RateLimiter::new(config.submit_per_hour, Duration::from_secs(3600)));
        Self {
            pool,
            cache,
            config: Arc::new(config),
            limiter,
            checker,
        }
    }
}

pub fn router(state: AppState) -> Router {
    let admin = Router::new()
        .route("/submissions", get(admin::list))
        .route("/submissions/{id}/approve", post(admin::approve))
        .route("/submissions/{id}/reject", post(admin::reject))
        .route_layer(middleware::from_fn_with_state(state.clone(), admin::require_token));

    let api = Router::new()
        .route("/health", get(public::health))
        .route("/bootstrap", get(public::bootstrap))
        .route("/providers", get(public::providers))
        .route("/models", get(public::models))
        .route("/meta", get(public::meta))
        .route("/incidents", get(public::incidents))
        .route("/incidents/{id}", get(public::incident))
        .route("/submissions", post(submit::create).layer(DefaultBodyLimit::max(32 * 1024)))
        .nest("/admin", admin)
        .fallback(|| async { ApiError::not_found() })
        .layer(DefaultBodyLimit::max(64 * 1024));

    let mut app = Router::new().nest("/api", api);
    if let Some(dir) = &state.config.static_dir {
        app = app.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(dir.join("index.html"))));
    }

    let cors = (!state.config.cors_origin.is_empty()).then(|| {
        let origins: Vec<HeaderValue> = state.config.cors_origin.iter().filter_map(|o| o.trim().parse().ok()).collect();
        CorsLayer::new()
            .allow_origin(AllowOrigin::list(origins))
            .allow_methods([Method::GET, Method::POST])
            .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION, header::IF_NONE_MATCH])
            .expose_headers([header::ETAG])
            .max_age(Duration::from_secs(3600))
    });

    app.with_state(state)
        .layer(CompressionLayer::new())
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("x-content-type-options"),
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::REFERRER_POLICY,
            HeaderValue::from_static("strict-origin-when-cross-origin"),
        ))
        .layer(tower::util::option_layer(cors))
        .layer(TraceLayer::new_for_http())
}
