//! Single-candidate port of `runPipeline` (scripts/lib/pipeline.ts), used when an admin approves a submission.

use crate::dedupe::{find_duplicate, fold};
use crate::model::{CandidateModel, Data, Incident, IncidentBody, Model};
use crate::validate;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

/// Checks that every source URL resolves. A trait so tests stay offline.
pub trait SourceChecker: Send + Sync {
    fn reachable<'a>(&'a self, urls: &'a [String]) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>>;
}

/// Same rules as `sourcesReachable` in scripts/lib/sources.ts: 403 and 429 count as reachable (bot walls).
pub struct HttpSourceChecker {
    client: reqwest::Client,
}

impl HttpSourceChecker {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent("felony-bench-api/1.0 (+https://github.com/sbayer55/felony-bench)")
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .expect("reqwest client");
        Self { client }
    }
}

impl Default for HttpSourceChecker {
    fn default() -> Self {
        Self::new()
    }
}

impl SourceChecker for HttpSourceChecker {
    fn reachable<'a>(&'a self, urls: &'a [String]) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move {
            for url in urls {
                match self.client.get(url).send().await {
                    Ok(res) => {
                        let s = res.status().as_u16();
                        if s >= 400 && s != 403 && s != 429 {
                            return Err(format!("source {url} returned {s}"));
                        }
                    }
                    Err(e) => return Err(format!("source {url} did not resolve: {e}")),
                }
            }
            Ok(())
        })
    }
}

pub fn slugify(s: &str, max: usize) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in fold(s).chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            if dash && !out.is_empty() {
                out.push('-');
            }
            dash = false;
            out.push(c);
        } else {
            dash = true;
        }
    }
    // JS: .replace(/^(.{1,max})(?:-.*)?$/, '$1') cuts at the last dash that keeps at most `max` chars, and leaves the
    // string alone when there is no such dash.
    if out.len() <= max {
        return out;
    }
    let bytes = out.as_bytes();
    (1..=max)
        .rev()
        .find(|&k| bytes[k] == b'-')
        .map_or(out.clone(), |k| out[..k].to_string())
}

pub fn make_id(body: &IncidentBody, taken: &HashSet<String>) -> String {
    let base = format!("{}-{}", body.date, slugify(&body.title, 48));
    let mut id = base.clone();
    let mut k = 2;
    while taken.contains(&id) {
        id = format!("{base}-{k}");
        k += 1;
    }
    id
}

#[derive(Debug)]
pub struct Accepted {
    pub incident: Incident,
    pub new_models: Vec<Model>,
}

pub async fn run(
    body: IncidentBody,
    candidate_models: &[CandidateModel],
    data: &Data,
    today: &str,
    checker: &dyn SourceChecker,
) -> Result<Accepted, String> {
    let issues = validate::incident_body(&body);
    if !issues.is_empty() {
        return Err(format!("schema: {}", issues.join("; ")));
    }
    let provider_ids: HashSet<&str> = data.providers.iter().map(|p| p.id.as_str()).collect();
    let mut model_by_id: HashMap<String, Model> = data.models.iter().map(|m| (m.id.clone(), m.clone())).collect();

    let mut new_models = Vec::new();
    for cm in candidate_models {
        if !validate::is_slug(&cm.id) || cm.name.trim().is_empty() || !provider_ids.contains(cm.provider_id.as_str()) {
            continue;
        }
        if model_by_id.contains_key(&cm.id) {
            continue;
        }
        let m = Model {
            id: cm.id.clone(),
            name: cm.name.trim().to_string(),
            provider_id: cm.provider_id.clone(),
            family: None,
            released: None,
            aliases: None,
        };
        model_by_id.insert(m.id.clone(), m.clone());
        new_models.push(m);
    }

    if body.date.as_str() > today {
        return Err(format!("dated in the future ({})", body.date));
    }
    let unknown: Vec<&str> = body
        .provider_ids
        .iter()
        .map(String::as_str)
        .filter(|p| !provider_ids.contains(p))
        .collect();
    if !unknown.is_empty() {
        return Err(format!("unknown provider(s): {}", unknown.join(", ")));
    }

    // Unknown models are dropped; the incident survives at provider level.
    let kept_models: Vec<String> = dedup(body.model_ids.iter().filter(|m| model_by_id.contains_key(*m)).cloned());
    let mut providers = dedup(body.provider_ids.iter().cloned());
    for m in &kept_models {
        let pid = &model_by_id[m].provider_id;
        if !providers.contains(pid) {
            providers.push(pid.clone());
        }
    }
    let normalized = IncidentBody {
        model_ids: kept_models,
        provider_ids: providers,
        ..body
    };

    if let Some(d) = find_duplicate(&normalized, &data.incidents, 0.8) {
        return Err(format!("duplicate of {} ({})", d.existing_id, d.reason));
    }
    let urls: Vec<String> = normalized.sources.iter().map(|s| s.url.clone()).collect();
    checker.reachable(&urls).await?;

    let taken: HashSet<String> = data.incidents.iter().map(|i| i.id.clone()).collect();
    let id = make_id(&normalized, &taken);
    let referenced: HashSet<&String> = normalized.model_ids.iter().collect();
    let new_models = new_models.into_iter().filter(|m| referenced.contains(&m.id)).collect();
    Ok(Accepted {
        incident: Incident { id, body: normalized },
        new_models,
    })
}

fn dedup(items: impl Iterator<Item = String>) -> Vec<String> {
    let mut seen = HashSet::new();
    items.filter(|s| seen.insert(s.clone())).collect()
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::model::{Provider, Source};

    pub struct Always(pub bool);
    impl SourceChecker for Always {
        fn reachable<'a>(&'a self, _: &'a [String]) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
            let ok = self.0;
            Box::pin(async move { if ok { Ok(()) } else { Err("a source URL did not resolve".into()) } })
        }
    }

    fn data() -> Data {
        let p = |id: &str| Provider {
            id: id.into(),
            name: id.into(),
            url: format!("https://{id}.example"),
            country: None,
            founded: None,
        };
        Data {
            providers: vec![p("acme"), p("globex")],
            models: vec![Model {
                id: "acme-1".into(),
                name: "Acme 1".into(),
                provider_id: "acme".into(),
                family: None,
                released: None,
                aliases: None,
            }],
            incidents: vec![Incident {
                id: "2026-01-01-old".into(),
                body: IncidentBody {
                    title: "Acme agent wipes customer backups".into(),
                    date: "2026-01-01".into(),
                    sources: vec![Source {
                        title: "Report".into(),
                        url: "https://news.example/acme".into(),
                        publisher: "News".into(),
                        date: "2026-01-01".into(),
                    }],
                    ..body()
                },
            }],
            meta: Default::default(),
        }
    }

    fn body() -> IncidentBody {
        IncidentBody {
            date: "2026-03-04".into(),
            title: "Globex model fabricates citations in court filing".into(),
            summary: "The court found the filing cited cases that do not exist.".into(),
            model_ids: vec!["globex-x".into(), "nope".into()],
            provider_ids: vec!["acme".into()],
            category: "fabrication".into(),
            degree: 1,
            evidence_class: "litigation".into(),
            role: "instrument".into(),
            attribution_confidence: "confirmed".into(),
            sources: vec![Source {
                title: "Order".into(),
                url: "https://court.example/order".into(),
                publisher: "Court".into(),
                date: "2026-03-04".into(),
            }],
            tags: Some(vec!["sanctions".into()]),
        }
    }

    #[test]
    fn slugify_matches_js() {
        assert_eq!(slugify("Café: Model — deletes DB!", 48), "cafe-model-deletes-db");
        assert_eq!(
            slugify(
                "Anthropic: ShinyHunters affiliates (GTG-50014) used Claude for terabyte-scale theft",
                48
            ),
            "anthropic-shinyhunters-affiliates-gtg-50014-used"
        );
        assert_eq!(slugify(&"a".repeat(60), 48), "a".repeat(60));
    }

    #[tokio::test]
    async fn accepts_and_normalizes() {
        let cm = [CandidateModel {
            id: "globex-x".into(),
            name: "Globex X".into(),
            provider_id: "globex".into(),
        }];
        let a = run(body(), &cm, &data(), "2026-09-30", &Always(true)).await.unwrap();
        assert_eq!(a.incident.id, "2026-03-04-globex-model-fabricates-citations-in-court");
        assert_eq!(a.incident.body.model_ids, vec!["globex-x"]);
        assert_eq!(a.incident.body.provider_ids, vec!["acme", "globex"]);
        assert_eq!(a.new_models.len(), 1);
    }

    #[tokio::test]
    async fn rejects() {
        let d = data();
        let future = IncidentBody {
            date: "2027-01-01".into(),
            ..body()
        };
        assert!(
            run(future, &[], &d, "2026-09-30", &Always(true))
                .await
                .unwrap_err()
                .contains("future")
        );
        let unknown = IncidentBody {
            provider_ids: vec!["initech".into()],
            ..body()
        };
        assert!(
            run(unknown, &[], &d, "2026-09-30", &Always(true))
                .await
                .unwrap_err()
                .contains("unknown provider")
        );
        let dupe = IncidentBody {
            date: "2026-01-05".into(),
            title: "Acme agent wipes the customer backups".into(),
            ..body()
        };
        assert!(
            run(dupe, &[], &d, "2026-09-30", &Always(true))
                .await
                .unwrap_err()
                .contains("duplicate of 2026-01-01-old")
        );
        assert!(
            run(body(), &[], &d, "2026-09-30", &Always(false))
                .await
                .unwrap_err()
                .contains("did not resolve")
        );
        let bad = IncidentBody { degree: 9, ..body() };
        assert!(
            run(bad, &[], &d, "2026-09-30", &Always(true))
                .await
                .unwrap_err()
                .starts_with("schema:")
        );
    }
}
