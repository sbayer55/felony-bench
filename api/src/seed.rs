//! Import and export the JSON snapshot in data/seed (same files the site used to bundle).

use crate::model::{Data, Incident, Model, Provider};
use crate::{repo, validate};
use anyhow::{Context, bail};
use sqlx::PgPool;
use std::path::Path;

#[derive(Debug, Default, PartialEq)]
pub struct SeedCounts {
    pub providers: usize,
    pub models: usize,
    pub incidents: usize,
}

fn read<T: serde::de::DeserializeOwned>(dir: &Path, name: &str) -> anyhow::Result<T> {
    let path = dir.join(name);
    let text = std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("parsing {}", path.display()))
}

pub fn read_dir(dir: &Path) -> anyhow::Result<(Vec<Provider>, Vec<Model>, Vec<Incident>)> {
    let providers: Vec<Provider> = read(dir, "providers.json")?;
    let models: Vec<Model> = read(dir, "models.json")?;
    let incidents: Vec<Incident> = read(dir, "incidents.json")?;
    let mut issues = Vec::new();
    for i in &incidents {
        if !validate::is_slug(&i.id) {
            issues.push(format!("{}: id must be a kebab-case slug", i.id));
        }
        issues.extend(validate::incident_body(&i.body).into_iter().map(|e| format!("{}: {e}", i.id)));
    }
    if !issues.is_empty() {
        bail!("seed data is invalid:\n  {}", issues.join("\n  "));
    }
    Ok((providers, models, incidents))
}

/// True when the database has no providers yet, i.e. it has never been seeded.
pub async fn is_empty(pool: &PgPool) -> anyhow::Result<bool> {
    let any: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM providers)")
        .fetch_one(pool)
        .await?;
    Ok(!any)
}

/// Inserts anything not already present, in one transaction. Referential problems abort the whole import.
pub async fn import(pool: &PgPool, dir: &Path) -> anyhow::Result<SeedCounts> {
    let (providers, models, incidents) = read_dir(dir)?;
    let mut tx = pool.begin().await?;
    let mut n = SeedCounts::default();
    for p in &providers {
        n.providers += repo::insert_provider(&mut tx, p)
            .await
            .with_context(|| format!("provider {}", p.id))? as usize;
    }
    for m in &models {
        n.models += repo::insert_model(&mut tx, m).await.with_context(|| format!("model {}", m.id))? as usize;
    }
    // Oldest first, so a fresh database gets ascending insertion order.
    for i in incidents.iter().rev() {
        n.incidents += repo::insert_incident(&mut tx, i)
            .await
            .with_context(|| format!("incident {}", i.id))? as usize;
    }
    repo::notify_changed(&mut tx).await?;
    tx.commit().await.context("commit (deferred integrity checks run here)")?;
    Ok(n)
}

fn write_json<T: serde::Serialize>(dir: &Path, name: &str, v: &T) -> anyhow::Result<()> {
    let mut text = serde_json::to_string_pretty(v)?;
    text.push('\n');
    std::fs::write(dir.join(name), text).with_context(|| format!("writing {name}"))
}

pub async fn export(pool: &PgPool, dir: &Path) -> anyhow::Result<Data> {
    let data = repo::load_all(pool).await?;
    std::fs::create_dir_all(dir)?;
    write_json(dir, "providers.json", &data.providers)?;
    write_json(dir, "models.json", &data.models)?;
    write_json(dir, "incidents.json", &data.incidents)?;
    Ok(data)
}
