//! The public read path never touches Postgres: the whole dataset is held in memory, with the bootstrap payload
//! pre-serialized and pre-compressed. It is swapped atomically whenever the data changes.

use crate::model::{Data, Incident};
use crate::repo;
use arc_swap::ArcSwap;
use bytes::Bytes;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use sqlx::postgres::PgListener;
use std::collections::HashMap;
use std::io::Write;
use std::sync::Arc;
use std::time::Duration;

pub struct Snapshot {
    pub data: Data,
    pub incident_index: HashMap<String, usize>,
    pub json: Bytes,
    pub gzip: Bytes,
    pub br: Bytes,
    pub etag: String,
}

impl Snapshot {
    pub fn build(data: Data) -> Self {
        let json = serde_json::to_vec(&data).expect("data serializes");
        let etag = format!("\"{}\"", hex::encode(&Sha256::digest(&json)[..12]));

        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
        gz.write_all(&json).expect("gzip");
        let gzip = gz.finish().expect("gzip");

        let mut br = Vec::new();
        {
            let mut w = brotli::CompressorWriter::new(&mut br, 4096, 11, 22);
            w.write_all(&json).expect("brotli");
        }

        let incident_index = data.incidents.iter().enumerate().map(|(i, inc)| (inc.id.clone(), i)).collect();
        Self {
            data,
            incident_index,
            json: json.into(),
            gzip: gzip.into(),
            br: br.into(),
            etag,
        }
    }

    pub fn incident(&self, id: &str) -> Option<&Incident> {
        self.incident_index.get(id).map(|&i| &self.data.incidents[i])
    }
}

#[derive(Clone)]
pub struct Cache(Arc<ArcSwap<Snapshot>>);

impl Cache {
    pub fn new(data: Data) -> Self {
        Self(Arc::new(ArcSwap::from_pointee(Snapshot::build(data))))
    }

    pub fn get(&self) -> Arc<Snapshot> {
        self.0.load_full()
    }

    pub async fn reload(&self, pool: &PgPool) -> sqlx::Result<()> {
        let data = repo::load_all(pool).await?;
        let snap = Snapshot::build(data);
        tracing::info!(incidents = snap.data.incidents.len(), etag = %snap.etag, "snapshot reloaded");
        self.0.store(Arc::new(snap));
        Ok(())
    }

    /// Reload on `NOTIFY data_changed` (sent by the refresh job and by admin approvals), plus a periodic safety net.
    pub fn spawn_watcher(&self, pool: PgPool, every: Duration) {
        let cache = self.clone();
        tokio::spawn(async move {
            loop {
                if let Err(e) = cache.listen(&pool, every).await {
                    tracing::warn!(error = %e, "listener failed; retrying in 5s");
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            }
        });
    }

    async fn listen(&self, pool: &PgPool, every: Duration) -> sqlx::Result<()> {
        let mut listener = PgListener::connect_with(pool).await?;
        listener.listen(repo::CHANGED_CHANNEL).await?;
        // Catch anything that changed while we were not listening.
        self.reload(pool).await?;
        loop {
            match tokio::time::timeout(every, listener.recv()).await {
                Ok(Ok(_)) => {
                    // Coalesce bursts (a refresh run may notify once per batch, approvals once each).
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    while listener.next_buffered().is_some() {}
                }
                Ok(Err(e)) => return Err(e),
                Err(_) => {}
            }
            self.reload(pool).await?;
        }
    }
}
