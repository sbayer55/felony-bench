use clap::Args;
use std::path::PathBuf;

#[derive(Debug, Clone, Args)]
pub struct Config {
    /// Bind address.
    #[arg(long, env = "HOST", default_value = "0.0.0.0")]
    pub host: String,
    #[arg(long, env = "PORT", default_value_t = 8787)]
    pub port: u16,
    /// Bearer token for /api/admin. Admin routes answer 401 to everything when unset.
    #[arg(long, env = "ADMIN_TOKEN", hide_env_values = true)]
    pub admin_token: Option<String>,
    /// Comma-separated origins allowed to call the API cross-origin. Same-origin only when unset.
    #[arg(long, env = "CORS_ORIGIN", value_delimiter = ',')]
    pub cors_origin: Vec<String>,
    /// Salt for hashing submitter IPs. Only the hash is stored.
    #[arg(long, env = "IP_SALT", default_value = "felony-bench", hide_env_values = true)]
    pub ip_salt: String,
    /// Serve the built SPA from this directory (with index.html fallback).
    #[arg(long, env = "STATIC_DIR")]
    pub static_dir: Option<PathBuf>,
    /// Trust X-Forwarded-For (rightmost entry). Enable only behind a reverse proxy you control.
    #[arg(long, env = "TRUST_PROXY", default_value_t = false)]
    pub trust_proxy: bool,
    /// Public submissions allowed per IP per hour.
    #[arg(long, env = "SUBMIT_PER_HOUR", default_value_t = 5)]
    pub submit_per_hour: usize,
    /// Public site URL used for absolute links in /feed.xml, e.g. https://felonybench.example. Derived from the
    /// request's Host (and X-Forwarded-Proto when TRUST_PROXY is set) when unset.
    #[arg(long, env = "PUBLIC_URL")]
    pub public_url: Option<String>,
    /// Safety-net snapshot reload interval, in seconds, on top of LISTEN/NOTIFY.
    #[arg(long, env = "RELOAD_SECS", default_value_t = 300)]
    pub reload_secs: u64,
}

impl Config {
    pub fn for_tests() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 0,
            admin_token: Some("test-admin-token-0123456789".into()),
            cors_origin: vec![],
            ip_salt: "test".into(),
            static_dir: None,
            trust_proxy: false,
            submit_per_hour: 5,
            public_url: None,
            reload_secs: 300,
        }
    }
}
