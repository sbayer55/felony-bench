//! Mirror of `IncidentBodySchema` in src/data/schema.ts, plus size caps for public submissions.

use crate::enums::ENUMS;
use crate::model::{CandidateModel, IncidentBody};
use chrono::NaiveDate;
use regex::Regex;
use std::sync::LazyLock;

static SLUG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z0-9]+(?:-[a-z0-9]+)*$").unwrap());
static ISO_DATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{4}-\d{2}-\d{2}$").unwrap());

pub const MAX_MODELS: usize = 20;
pub const MAX_PROVIDERS: usize = 10;
pub const MAX_SOURCES: usize = 10;
pub const MAX_TAGS: usize = 20;
pub const MAX_TAG_LEN: usize = 60;
pub const MAX_FIELD_LEN: usize = 300;

pub fn is_slug(s: &str) -> bool {
    SLUG.is_match(s)
}

pub fn is_iso_date(s: &str) -> bool {
    ISO_DATE.is_match(s) && NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

pub fn is_https_url(s: &str) -> bool {
    s.starts_with("https://") && url::Url::parse(s).is_ok_and(|u| u.host_str().is_some_and(|h| !h.is_empty()))
}

/// JS string length (UTF-16 code units), so limits agree with zod's `.max()`.
fn js_len(s: &str) -> usize {
    s.encode_utf16().count()
}

fn non_empty(issues: &mut Vec<String>, path: &str, s: &str, max: usize) {
    if s.trim().is_empty() {
        issues.push(format!("{path}: required"));
    } else if js_len(s) > max {
        issues.push(format!("{path}: must be at most {max} characters"));
    }
}

/// Returns every problem found, using the same `path: message` shape the TS validator prints.
pub fn incident_body(b: &IncidentBody) -> Vec<String> {
    let mut issues = Vec::new();
    if !is_iso_date(&b.date) {
        issues.push("date: must be YYYY-MM-DD".into());
    }
    non_empty(&mut issues, "title", &b.title, 140);
    non_empty(&mut issues, "summary", &b.summary, 900);

    if b.model_ids.len() > MAX_MODELS {
        issues.push(format!("modelIds: at most {MAX_MODELS}"));
    }
    for (i, m) in b.model_ids.iter().enumerate() {
        if !is_slug(m) {
            issues.push(format!("modelIds.{i}: must be a kebab-case slug"));
        }
    }
    if b.provider_ids.is_empty() {
        issues.push("providerIds: at least one provider".into());
    }
    if b.provider_ids.len() > MAX_PROVIDERS {
        issues.push(format!("providerIds: at most {MAX_PROVIDERS}"));
    }
    for (i, p) in b.provider_ids.iter().enumerate() {
        if !is_slug(p) {
            issues.push(format!("providerIds.{i}: must be a kebab-case slug"));
        }
    }

    if !ENUMS.categories.contains(&b.category) {
        issues.push(format!("category: must be one of {}", ENUMS.categories.join(", ")));
    }
    if !ENUMS.degrees.contains(&b.degree) {
        issues.push("degree: must be 1, 2 or 3".into());
    }
    if !ENUMS.evidence_classes.contains(&b.evidence_class) {
        issues.push(format!("evidenceClass: must be one of {}", ENUMS.evidence_classes.join(", ")));
    }
    if !ENUMS.roles.contains(&b.role) {
        issues.push(format!("role: must be one of {}", ENUMS.roles.join(", ")));
    }
    if !ENUMS.attribution.contains(&b.attribution_confidence) {
        issues.push(format!("attributionConfidence: must be one of {}", ENUMS.attribution.join(", ")));
    }

    if b.sources.is_empty() {
        issues.push("sources: at least one source".into());
    }
    if b.sources.len() > MAX_SOURCES {
        issues.push(format!("sources: at most {MAX_SOURCES}"));
    }
    for (i, s) in b.sources.iter().enumerate() {
        non_empty(&mut issues, &format!("sources.{i}.title"), &s.title, MAX_FIELD_LEN);
        non_empty(&mut issues, &format!("sources.{i}.publisher"), &s.publisher, MAX_FIELD_LEN);
        if !is_https_url(&s.url) || js_len(&s.url) > 2000 {
            issues.push(format!("sources.{i}.url: must be an https URL"));
        }
        if !is_iso_date(&s.date) {
            issues.push(format!("sources.{i}.date: must be YYYY-MM-DD"));
        }
    }

    if let Some(tags) = &b.tags {
        if tags.len() > MAX_TAGS {
            issues.push(format!("tags: at most {MAX_TAGS}"));
        }
        for (i, t) in tags.iter().enumerate() {
            if t.trim().is_empty() || js_len(t) > MAX_TAG_LEN {
                issues.push(format!("tags.{i}: 1 to {MAX_TAG_LEN} characters"));
            }
        }
    }
    issues
}

pub fn candidate_models(models: &[CandidateModel]) -> Vec<String> {
    let mut issues = Vec::new();
    if models.len() > MAX_MODELS {
        issues.push(format!("candidateModels: at most {MAX_MODELS}"));
    }
    for (i, m) in models.iter().enumerate() {
        if !is_slug(&m.id) {
            issues.push(format!("candidateModels.{i}.id: must be a kebab-case slug"));
        }
        if !is_slug(&m.provider_id) {
            issues.push(format!("candidateModels.{i}.providerId: must be a kebab-case slug"));
        }
        non_empty(&mut issues, &format!("candidateModels.{i}.name"), &m.name, 120);
    }
    issues
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Source;

    pub fn body() -> IncidentBody {
        IncidentBody {
            date: "2026-01-02".into(),
            title: "Acme model deletes production database".into(),
            summary: "Acme said its model deleted a database.".into(),
            model_ids: vec!["acme-1".into()],
            provider_ids: vec!["acme".into()],
            category: "destruction".into(),
            degree: 2,
            evidence_class: "production".into(),
            role: "actor".into(),
            attribution_confidence: "confirmed".into(),
            sources: vec![Source {
                title: "Postmortem".into(),
                url: "https://acme.example/postmortem".into(),
                publisher: "Acme".into(),
                date: "2026-01-02".into(),
            }],
            tags: None,
        }
    }

    #[test]
    fn accepts_a_valid_body() {
        assert!(incident_body(&body()).is_empty());
    }

    #[test]
    fn reports_each_problem() {
        let mut b = body();
        b.date = "2026-02-30".into();
        b.title = "x".repeat(141);
        b.provider_ids = vec![];
        b.category = "jaywalking".into();
        b.degree = 4;
        b.sources[0].url = "http://acme.example".into();
        let issues = incident_body(&b);
        for want in ["date:", "title:", "providerIds:", "category:", "degree:", "sources.0.url:"] {
            assert!(issues.iter().any(|i| i.starts_with(want)), "missing {want} in {issues:?}");
        }
    }

    #[test]
    fn slug_and_url_rules() {
        assert!(is_slug("gpt-4o"));
        assert!(!is_slug("GPT-4o"));
        assert!(!is_slug("a--b"));
        assert!(is_https_url("https://example.com/x?y=1"));
        assert!(!is_https_url("https://"));
        assert!(!is_https_url("javascript:alert(1)"));
    }
}
