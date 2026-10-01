//! Controlled vocabularies, shared with the frontend through shared/enums.json.

use serde::Deserialize;
use std::sync::LazyLock;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Enums {
    pub categories: Vec<String>,
    pub evidence_classes: Vec<String>,
    pub roles: Vec<String>,
    pub attribution: Vec<String>,
    pub degrees: Vec<u8>,
}

pub static ENUMS: LazyLock<Enums> =
    LazyLock::new(|| serde_json::from_str(include_str!("../../shared/enums.json")).expect("shared/enums.json is valid"));
