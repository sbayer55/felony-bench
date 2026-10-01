pub mod app;
pub mod cache;
pub mod config;
pub mod dedupe;
pub mod enums;
pub mod error;
pub mod feed;
pub mod limit;
pub mod model;
pub mod pipeline;
pub mod repo;
pub mod routes;
pub mod seed;
pub mod validate;

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");
