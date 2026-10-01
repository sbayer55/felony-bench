//! RSS 2.0 feed of the newest incidents, rendered from the in-memory snapshot.

use crate::model::{Data, Incident};
use chrono::NaiveDate;
use std::collections::HashMap;
use std::fmt::Write;

/// Items in the feed. Readers only need recent entries; the docket has the rest.
pub const FEED_ITEMS: usize = 50;

/// Escapes text for XML element content and attribute values.
fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            // Control characters other than tab/newline/CR are not legal in XML 1.0.
            c if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') => {}
            c => out.push(c),
        }
    }
    out
}

/// `YYYY-MM-DD` as an RFC 822 date at midnight UTC, which is what RSS readers expect.
fn rfc822(date: &str) -> Option<String> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .ok()
        .map(|d| d.format("%a, %d %b %Y 00:00:00 +0000").to_string())
}

/// The item description, as HTML: summary, then the sources it rests on.
fn description(inc: &Incident, providers: &HashMap<&str, &str>) -> String {
    let b = &inc.body;
    let names: Vec<&str> = b
        .provider_ids
        .iter()
        .map(|id| providers.get(id.as_str()).copied().unwrap_or(id))
        .collect();
    let mut html = format!(
        "<p>{}</p><p>{} · degree {} · {} · {}</p><ul>",
        esc(&b.summary),
        esc(&names.join(", ")),
        b.degree,
        esc(&b.evidence_class),
        esc(&b.attribution_confidence),
    );
    for s in &b.sources {
        let _ = write!(
            html,
            "<li><a href=\"{}\">{}</a> ({}, {})</li>",
            esc(&s.url),
            esc(&s.title),
            esc(&s.publisher),
            esc(&s.date)
        );
    }
    html.push_str("</ul>");
    html
}

/// Renders the feed. `base` is the public site origin (plus any path prefix) without a trailing slash.
pub fn render(data: &Data, base: &str) -> String {
    let providers: HashMap<&str, &str> = data.providers.iter().map(|p| (p.id.as_str(), p.name.as_str())).collect();
    let mut xml = String::with_capacity(64 * 1024);
    xml.push_str(r#"<?xml version="1.0" encoding="UTF-8"?>"#);
    xml.push_str(r#"<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>"#);
    let _ = write!(
        xml,
        "<title>Felony Bench</title><link>{b}/docket</link>\
         <atom:link href=\"{b}/feed.xml\" rel=\"self\" type=\"application/rss+xml\"/>\
         <description>Newly documented criminal and criminal-adjacent conduct attributed to large language models.</description>\
         <language>en</language><ttl>60</ttl>",
        b = esc(base)
    );
    // Incidents are already newest first (repo::load_all orders by date DESC).
    if let Some(d) = data.incidents.first().and_then(|i| rfc822(&i.body.date)) {
        let _ = write!(xml, "<lastBuildDate>{d}</lastBuildDate>");
    }
    for inc in data.incidents.iter().take(FEED_ITEMS) {
        let link = format!("{base}/docket/{}", inc.id);
        let _ = write!(
            xml,
            "<item><title>{}</title><link>{l}</link><guid isPermaLink=\"true\">{l}</guid><category>{}</category>",
            esc(&inc.body.title),
            esc(&inc.body.category),
            l = esc(&link),
        );
        if let Some(d) = rfc822(&inc.body.date) {
            let _ = write!(xml, "<pubDate>{d}</pubDate>");
        }
        let _ = write!(xml, "<description>{}</description></item>", esc(&description(inc, &providers)));
    }
    xml.push_str("</channel></rss>");
    xml
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_markup_and_drops_illegal_control_chars() {
        assert_eq!(esc("a<b>&\"c'\u{1}\n"), "a&lt;b&gt;&amp;&quot;c&apos;\n");
    }

    #[test]
    fn formats_rfc822_dates() {
        assert_eq!(rfc822("2026-09-10").as_deref(), Some("Thu, 10 Sep 2026 00:00:00 +0000"));
        assert_eq!(rfc822("nope"), None);
    }
}
