use anyhow::Context;
use clap::{Parser, Subcommand};
use felony_api::app::{AppState, router};
use felony_api::cache::Cache;
use felony_api::config::Config;
use felony_api::pipeline::HttpSourceChecker;
use felony_api::{MIGRATOR, repo, seed};
use sqlx::postgres::PgPoolOptions;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "felony-api", about = "Felony Bench API")]
struct Cli {
    #[arg(long, env = "DATABASE_URL", hide_env_values = true)]
    database_url: Option<String>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run migrations, then serve the API (and the SPA when STATIC_DIR is set).
    Serve(Config),
    /// Apply pending migrations and exit.
    Migrate,
    /// Import providers.json, models.json and incidents.json from a directory. Idempotent.
    Seed {
        #[arg(default_value = "data/seed")]
        dir: PathBuf,
        /// Only import into a database that has never been seeded (used on every container start).
        #[arg(long)]
        if_empty: bool,
    },
    /// Write the database back out as JSON in the seed format.
    Export {
        #[arg(default_value = "data/seed")]
        dir: PathBuf,
    },
    /// Exit 0 if the local server answers /api/health. For container healthchecks; needs no DATABASE_URL.
    Healthcheck {
        #[arg(long, env = "PORT", default_value_t = 8787)]
        port: u16,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "felony_api=info,tower_http=info".into()))
        .init();
    dotenvy::dotenv().ok();
    let cli = Cli::parse();
    if let Command::Healthcheck { port } = cli.command {
        return healthcheck(port).await;
    }
    let database_url = cli.database_url.context("DATABASE_URL is not set")?;
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&database_url)
        .await?;

    match cli.command {
        Command::Migrate => {
            MIGRATOR.run(&pool).await?;
            tracing::info!("migrations applied");
        }
        Command::Seed { dir, if_empty } => {
            MIGRATOR.run(&pool).await?;
            if if_empty && !seed::is_empty(&pool).await? {
                tracing::info!("database already seeded; skipping");
                return Ok(());
            }
            let n = seed::import(&pool, &dir).await?;
            tracing::info!(
                providers = n.providers,
                models = n.models,
                incidents = n.incidents,
                "seeded (new rows)"
            );
        }
        Command::Export { dir } => {
            let d = seed::export(&pool, &dir).await?;
            tracing::info!(providers = d.providers.len(), models = d.models.len(), incidents = d.incidents.len(), dir = %dir.display(), "exported");
        }
        Command::Serve(config) => serve(pool, config).await?,
        Command::Healthcheck { .. } => unreachable!(),
    }
    Ok(())
}

async fn serve(pool: sqlx::PgPool, config: Config) -> anyhow::Result<()> {
    MIGRATOR.run(&pool).await?;
    if config.admin_token.as_deref().is_none_or(|t| t.len() < 16) {
        tracing::warn!("ADMIN_TOKEN is unset or shorter than 16 characters; admin routes will reject everything");
    }
    let cache = Cache::new(repo::load_all(&pool).await?);
    cache.spawn_watcher(pool.clone(), Duration::from_secs(config.reload_secs));

    let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;
    let state = AppState::new(pool, cache, config, Arc::new(HttpSourceChecker::new()));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "listening");
    axum::serve(listener, router(state).into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}

async fn healthcheck(port: u16) -> anyhow::Result<()> {
    let res = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()?
        .get(format!("http://127.0.0.1:{port}/api/health"))
        .send()
        .await?;
    anyhow::ensure!(res.status().is_success(), "health returned {}", res.status());
    Ok(())
}

async fn shutdown() {
    let ctrl_c = async { tokio::signal::ctrl_c().await.ok() };
    #[cfg(unix)]
    let term = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("signal handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
    tracing::info!("shutting down");
}
