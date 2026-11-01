//! Runtime configuration from environment variables.
//!
//! | Variable | Default | Meaning |
//! | --- | --- | --- |
//! | `BIND_ADDR` | `0.0.0.0:3000` | Listen address |
//! | `VALKEY_URL` | – | Valkey (Redis protocol) holding tokens and rate limits; required for `/v1` |
//! | `VALKEY_MODE` | `auto` | `auto` (detects cluster mode), `standalone` or `cluster` |
//! | `FREE_RATE_LIMIT_PER_MINUTE` | `20` | Invoices per minute for a free token (static) |
//! | `FREE_TOKEN_TTL_SECONDS` | `43200` | Lifetime of a free token (12 h) |
//! | `ANUBIS_PUBLIC_KEY_HEX` | – | Ed25519 public key (hex) of Anubis; enables `POST /v1/free-token` |
//! | `ANUBIS_COOKIE_NAME` | `techaro.lol-anubis-auth` | Name of the Anubis pass cookie |
//! | `PAID_TOKENS_ENABLED` | `false` | Feature flag: accept purchased tokens |
//! | `PAID_PLANS` | `starter=60,business=300,pro=1000` | Paid plans as `name=invoices_per_minute` |
//! | `STRIPE_WEBHOOK_SECRET` | empty | Signing secret (`whsec_…`) of the Stripe webhook endpoint |
//! | `PAID_GRACE_DAYS` | `3` | Extra days after a paid subscription period before the token expires |
//! | `PAID_TOKEN_RETENTION_DAYS` | `365` | How long an expired paid token stays in Valkey (renewable by its id) |
//! | `BULK_MAX_INVOICES` | `100` | Maximum invoices per bulk request |
//! | `MAX_CONCURRENT_COMPILES` | CPU count | Simultaneous Typst compilations |
//! | `METRICS_ADDR` | `0.0.0.0:9090` | Listen address of `GET /metrics` (OpenMetrics); `off` disables it |
//! | `CORS_ALLOWED_ORIGINS` | any | Comma-separated origins, or `*` |

use std::sync::OnceLock;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

pub struct Config {
    pub bind_addr: String,
    pub metrics_addr: Option<String>,
    pub valkey_url: Option<String>,
    pub valkey_mode: String,
    pub free_rate_limit_per_minute: u32,
    pub free_token_ttl_secs: u64,
    pub anubis_public_key_hex: Option<String>,
    pub anubis_cookie_name: String,
    pub paid_tokens_enabled: bool,
    pub paid_plans: Vec<(String, u32)>,
    pub paid_retention_days: u64,
    pub stripe_webhook_secret: Option<String>,
    pub paid_grace_days: u64,
    pub bulk_max_invoices: usize,
    pub max_concurrent_compiles: usize,
    pub cors_origins: Option<Vec<String>>,
}

fn env_parse<T: std::str::FromStr>(name: &str, default: T) -> T {
    match std::env::var(name) {
        Ok(v) if !v.trim().is_empty() => v.trim().parse().unwrap_or_else(|_| {
            tracing::warn!(event = "invalid_config", name, value = %v, "invalid value, using the default");
            default
        }),
        _ => default,
    }
}

fn env_list(name: &str) -> Vec<String> {
    std::env::var(name)
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn parse_plans(raw: &str) -> Vec<(String, u32)> {
    raw.split(',')
        .filter_map(|entry| {
            let (name, limit) = entry.split_once('=')?;
            let limit = limit.trim().parse::<u32>().ok()?.max(1);
            let name = name.trim().to_ascii_lowercase();
            (!name.is_empty()).then_some((name, limit))
        })
        .collect()
}

impl Config {
    fn from_env() -> Self {
        let cors = env_list("CORS_ALLOWED_ORIGINS");
        let cors_origins = if cors.is_empty() || cors.iter().any(|o| o == "*") {
            None
        } else {
            Some(cors)
        };
        let cpus = std::thread::available_parallelism().map_or(2, |n| n.get());
        let plans_raw = std::env::var("PAID_PLANS")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "starter=60,business=300,pro=1000".into());
        Self {
            bind_addr: std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".into()),
            metrics_addr: Some(std::env::var("METRICS_ADDR").unwrap_or_else(|_| "0.0.0.0:9090".into()))
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty() && !v.eq_ignore_ascii_case("off")),
            valkey_url: std::env::var("VALKEY_URL").ok().filter(|v| !v.trim().is_empty()),
            valkey_mode: match std::env::var("VALKEY_MODE").unwrap_or_default().trim().to_ascii_lowercase().as_str() {
                m @ ("standalone" | "cluster") => m.to_string(),
                _ => "auto".to_string(),
            },
            free_rate_limit_per_minute: env_parse("FREE_RATE_LIMIT_PER_MINUTE", 20u32).max(1),
            free_token_ttl_secs: env_parse("FREE_TOKEN_TTL_SECONDS", 43_200u64).max(60),
            anubis_public_key_hex: std::env::var("ANUBIS_PUBLIC_KEY_HEX").ok().filter(|v| !v.trim().is_empty()),
            anubis_cookie_name: std::env::var("ANUBIS_COOKIE_NAME")
                .ok()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| "techaro.lol-anubis-auth".into()),
            paid_tokens_enabled: env_parse("PAID_TOKENS_ENABLED", false),
            paid_plans: parse_plans(&plans_raw),
            paid_retention_days: env_parse("PAID_TOKEN_RETENTION_DAYS", 365u64),
            stripe_webhook_secret: std::env::var("STRIPE_WEBHOOK_SECRET").ok().filter(|v| !v.trim().is_empty()),
            paid_grace_days: env_parse("PAID_GRACE_DAYS", 3u64),
            bulk_max_invoices: env_parse("BULK_MAX_INVOICES", 100usize).max(1),
            max_concurrent_compiles: env_parse("MAX_CONCURRENT_COMPILES", cpus).max(1),
            cors_origins,
        }
    }

    pub fn plan_limit(&self, plan: &str) -> Option<u32> {
        self.paid_plans.iter().find(|(n, _)| n == plan).map(|(_, l)| *l)
    }
}

static CONFIG: OnceLock<Config> = OnceLock::new();

pub fn get() -> &'static Config {
    CONFIG.get_or_init(Config::from_env)
}

pub fn cors_layer() -> CorsLayer {
    let layer = CorsLayer::new().allow_methods(Any).allow_headers(Any);
    match &get().cors_origins {
        None => layer.allow_origin(Any),
        Some(origins) => layer.allow_origin(AllowOrigin::list(
            origins.iter().filter_map(|o| o.parse().ok()),
        )),
    }
}
