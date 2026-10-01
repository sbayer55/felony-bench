//! Wire types. Field order and casing match src/data/schema.ts so JSON round-trips byte-for-byte.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub founded: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub name: String,
    pub provider_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub released: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aliases: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Source {
    pub title: String,
    pub url: String,
    pub publisher: String,
    pub date: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncidentBody {
    pub date: String,
    pub title: String,
    pub summary: String,
    pub model_ids: Vec<String>,
    pub provider_ids: Vec<String>,
    pub category: String,
    pub degree: u8,
    pub evidence_class: String,
    pub role: String,
    pub attribution_confidence: String,
    pub sources: Vec<Source>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Incident {
    pub id: String,
    #[serde(flatten)]
    pub body: IncidentBody,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub last_refreshed: Option<String>,
    pub last_run_added: i64,
    pub last_run_rejected: i64,
    pub run_id: Option<String>,
}

/// A model the submitter or the research job proposes adding to the roster.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateModel {
    pub id: String,
    pub name: String,
    pub provider_id: String,
}

/// Everything the public site needs, in one payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Data {
    pub providers: Vec<Provider>,
    pub models: Vec<Model>,
    pub incidents: Vec<Incident>,
    pub meta: Meta,
}
