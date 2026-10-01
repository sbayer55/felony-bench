//! Per-IP sliding-window limiter for public writes. In-memory, so limits are per instance.

use axum::http::HeaderMap;
use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct RateLimiter {
    max: usize,
    window: Duration,
    hits: Mutex<HashMap<IpAddr, VecDeque<Instant>>>,
}

impl RateLimiter {
    pub fn new(max: usize, window: Duration) -> Self {
        Self {
            max,
            window,
            hits: Mutex::new(HashMap::new()),
        }
    }

    /// Records a hit and returns whether it is allowed.
    pub fn check(&self, ip: IpAddr) -> bool {
        self.check_at(ip, Instant::now())
    }

    fn check_at(&self, ip: IpAddr, now: Instant) -> bool {
        let mut hits = self.hits.lock().unwrap();
        if hits.len() > 10_000 {
            hits.retain(|_, q| q.back().is_some_and(|t| now.duration_since(*t) < self.window));
        }
        let q = hits.entry(ip).or_default();
        while q.front().is_some_and(|t| now.duration_since(*t) >= self.window) {
            q.pop_front();
        }
        if q.len() >= self.max {
            return false;
        }
        q.push_back(now);
        true
    }
}

/// The peer address, or the rightmost X-Forwarded-For entry when running behind a trusted proxy.
pub fn client_ip(headers: &HeaderMap, peer: Option<SocketAddr>, trust_proxy: bool) -> Option<IpAddr> {
    if trust_proxy {
        let forwarded = headers
            .get_all("x-forwarded-for")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .flat_map(|v| v.split(','))
            .filter_map(|s| s.trim().parse::<IpAddr>().ok())
            .next_back();
        if forwarded.is_some() {
            return forwarded;
        }
    }
    peer.map(|p| p.ip())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sliding_window() {
        let l = RateLimiter::new(2, Duration::from_secs(60));
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        let t0 = Instant::now();
        assert!(l.check_at(ip, t0));
        assert!(l.check_at(ip, t0));
        assert!(!l.check_at(ip, t0 + Duration::from_secs(59)));
        assert!(l.check_at("10.0.0.2".parse().unwrap(), t0));
        assert!(l.check_at(ip, t0 + Duration::from_secs(61)));
    }

    #[test]
    fn forwarded_only_when_trusted() {
        let mut h = HeaderMap::new();
        h.insert("x-forwarded-for", "1.1.1.1, 2.2.2.2".parse().unwrap());
        let peer = Some("9.9.9.9:1".parse().unwrap());
        assert_eq!(client_ip(&h, peer, false), Some("9.9.9.9".parse().unwrap()));
        assert_eq!(client_ip(&h, peer, true), Some("2.2.2.2".parse().unwrap()));
    }
}
