//! Port of scripts/lib/dedupe.ts. Parity is pinned by shared/fixtures/dedupe-cases.json, which both test suites run.

use crate::model::{Incident, IncidentBody};
use chrono::NaiveDate;
use regex::Regex;
use std::collections::HashSet;
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;

const STOP: &[&str] = &[
    "the", "a", "an", "of", "in", "on", "to", "and", "for", "by", "with", "at", "from", "its", "as", "is", "was", "after", "over",
];

static TRACKING_PARAM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(utm_|fbclid|gclid|ref$|source$)").unwrap());

pub fn normalize_url(u: &str) -> String {
    let Ok(mut url) = url::Url::parse(u) else {
        return u.trim().to_lowercase();
    };
    url.set_fragment(None);
    let kept: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(k, _)| !TRACKING_PARAM.is_match(k))
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    let host = match (url.host_str(), url.port()) {
        (Some(h), Some(p)) => format!("{}:{p}", h.to_lowercase()),
        (Some(h), None) => h.to_lowercase(),
        (None, _) => String::new(),
    };
    let mut s = format!("{}://{}{}", url.scheme(), host, url.path().trim_end_matches('/'));
    if !kept.is_empty() {
        let q = url::form_urlencoded::Serializer::new(String::new()).extend_pairs(kept).finish();
        s.push('?');
        s.push_str(&q);
    }
    for prefix in ["https://www.", "http://www."] {
        if let Some(rest) = s.strip_prefix(prefix) {
            return format!("https://{rest}");
        }
    }
    s
}

/// Lowercase, strip accents, keep ASCII alphanumerics. Shared by `tokens` and the pipeline's `slugify`.
pub fn fold(s: &str) -> String {
    s.to_lowercase().nfkd().filter(|c| !('\u{0300}'..='\u{036f}').contains(c)).collect()
}

pub fn tokens(title: &str) -> HashSet<String> {
    let cleaned: String = fold(title)
        .chars()
        .map(|c| {
            if c.is_ascii_lowercase() || c.is_ascii_digit() || c.is_whitespace() {
                c
            } else {
                ' '
            }
        })
        .collect();
    cleaned
        .split_whitespace()
        .filter(|t| !STOP.contains(t))
        .map(str::to_owned)
        .collect()
}

/// Jaccard similarity on content tokens, 0..1.
pub fn title_similarity(a: &str, b: &str) -> f64 {
    let (ta, tb) = (tokens(a), tokens(b));
    if ta.is_empty() || tb.is_empty() {
        return 0.0;
    }
    let inter = ta.intersection(&tb).count();
    inter as f64 / (ta.len() + tb.len() - inter) as f64
}

pub fn days_between(a: &str, b: &str) -> f64 {
    match (NaiveDate::parse_from_str(a, "%Y-%m-%d"), NaiveDate::parse_from_str(b, "%Y-%m-%d")) {
        (Ok(x), Ok(y)) => (x - y).num_days().abs() as f64,
        _ => f64::NAN,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DupeMatch {
    pub existing_id: String,
    pub reason: &'static str,
}

pub fn find_duplicate(candidate: &IncidentBody, existing: &[Incident], threshold: f64) -> Option<DupeMatch> {
    let cand_urls: HashSet<String> = candidate.sources.iter().map(|s| normalize_url(&s.url)).collect();
    for inc in existing {
        if inc.body.sources.iter().any(|s| cand_urls.contains(&normalize_url(&s.url))) {
            return Some(DupeMatch {
                existing_id: inc.id.clone(),
                reason: "source-url",
            });
        }
    }
    for inc in existing {
        if !inc.body.provider_ids.iter().any(|p| candidate.provider_ids.contains(p)) {
            continue;
        }
        // NaN (unparseable date) compares false, same as the JS `> 30` check.
        if days_between(&inc.body.date, &candidate.date) > 30.0 {
            continue;
        }
        if title_similarity(&inc.body.title, &candidate.title) >= threshold {
            return Some(DupeMatch {
                existing_id: inc.id.clone(),
                reason: "similar-title",
            });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Fixtures {
        #[serde(rename = "normalizeUrl")]
        normalize_url: Vec<(String, String)>,
        #[serde(rename = "titleSimilarity")]
        title_similarity: Vec<(String, String, f64)>,
        #[serde(rename = "findDuplicate")]
        find_duplicate: Vec<DupeCase>,
    }

    #[derive(Deserialize)]
    struct DupeCase {
        name: String,
        candidate: IncidentBody,
        existing: Vec<Incident>,
        expect: Option<ExpectMatch>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ExpectMatch {
        existing_id: String,
        reason: String,
    }

    fn fixtures() -> Fixtures {
        serde_json::from_str(include_str!("../../shared/fixtures/dedupe-cases.json")).unwrap()
    }

    #[test]
    fn normalize_url_matches_fixtures() {
        for (input, want) in fixtures().normalize_url {
            assert_eq!(normalize_url(&input), want, "normalize_url({input})");
        }
    }

    #[test]
    fn title_similarity_matches_fixtures() {
        for (a, b, want) in fixtures().title_similarity {
            let got = title_similarity(&a, &b);
            assert!((got - want).abs() < 1e-9, "title_similarity({a:?}, {b:?}) = {got}, want {want}");
        }
    }

    #[test]
    fn find_duplicate_matches_fixtures() {
        for case in fixtures().find_duplicate {
            let got = find_duplicate(&case.candidate, &case.existing, 0.8);
            match (&got, &case.expect) {
                (None, None) => {}
                (Some(g), Some(w)) => {
                    assert_eq!(
                        (g.existing_id.as_str(), g.reason),
                        (w.existing_id.as_str(), w.reason.as_str()),
                        "{}",
                        case.name
                    )
                }
                _ => panic!("{}: got {got:?}", case.name),
            }
        }
    }
}
