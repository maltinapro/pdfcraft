//! Runtime configuration from environment variables.
//!
//! | Variable | Default | Meaning |
//! | --- | --- | --- |
//! | `BIND_ADDR` | `0.0.0.0:3000` | Listen address |
//! | `VALKEY_URL` | – | Valkey (Redis protocol) holding tokens and rate limits; required for `/v1` |
//! | `FREE_RATE_LIMIT_PER_MINUTE` | `20` | Invoices per minute for a free token (static) |
//! | `FREE_TOKEN_TTL_SECONDS` | `43200` | Lifetime of a free token (12 h) |
//! | `PAID_TOKENS_ENABLED` | `false` | Feature flag: accept purchased tokens |
//! | `PAID_PLANS` | `starter=60,business=300,pro=1000` | Paid plans as `name=invoices_per_minute` |
//! | `PAID_TOKEN_RETENTION_DAYS` | `365` | How long an expired paid token stays in Valkey (renewable by its id) |
//! | `BULK_MAX_INVOICES` | `100` | Maximum invoices per bulk request |
//! | `MAX_CONCURRENT_COMPILES` | CPU count | Simultaneous Typst compilations |
//! | `CORS_ALLOWED_ORIGINS` | any | Comma-separated origins, or `*` |
//! | `ENABLE_GENERATE_PDF` | `true` | Set `false` to disable `POST /generate-pdf` (arbitrary templates) |

use std::sync::OnceLock;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

pub struct Config {
    pub bind_addr: String,
    pub valkey_url: Option<String>,
    pub free_rate_limit_per_minute: u32,
    pub free_token_ttl_secs: u64,
    pub paid_tokens_enabled: bool,
    pub paid_plans: Vec<(String, u32)>,
    pub paid_retention_days: u64,
    pub bulk_max_invoices: usize,
    pub max_concurrent_compiles: usize,
    pub cors_origins: Option<Vec<String>>,
    pub enable_generate_pdf: bool,
}

fn env_parse<T: std::str::FromStr>(name: &str, default: T) -> T {
    match std::env::var(name) {
        Ok(v) if !v.trim().is_empty() => v.trim().parse().unwrap_or_else(|_| {
            eprintln!("warning: invalid {name}={v:?}, using the default");
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
            valkey_url: std::env::var("VALKEY_URL").ok().filter(|v| !v.trim().is_empty()),
            free_rate_limit_per_minute: env_parse("FREE_RATE_LIMIT_PER_MINUTE", 20u32).max(1),
            free_token_ttl_secs: env_parse("FREE_TOKEN_TTL_SECONDS", 43_200u64).max(60),
            paid_tokens_enabled: env_parse("PAID_TOKENS_ENABLED", false),
            paid_plans: parse_plans(&plans_raw),
            paid_retention_days: env_parse("PAID_TOKEN_RETENTION_DAYS", 365u64),
            bulk_max_invoices: env_parse("BULK_MAX_INVOICES", 100usize).max(1),
            max_concurrent_compiles: env_parse("MAX_CONCURRENT_COMPILES", cpus).max(1),
            cors_origins,
            enable_generate_pdf: env_parse("ENABLE_GENERATE_PDF", true),
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
