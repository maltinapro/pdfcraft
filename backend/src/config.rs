//! Runtime configuration from environment variables.
//!
//! | Variable | Default | Meaning |
//! | --- | --- | --- |
//! | `BIND_ADDR` | `0.0.0.0:3000` | Listen address |
//! | `API_KEYS` | – | Comma-separated static API keys (optional when `DATABASE_URL` is set) |
//! | `DATABASE_URL` | – | Postgres with the `api_keys` table (manage via `keys` subcommand) |
//! | `REDIS_URL` | – | Shared rate limit across instances; in-memory without it |
//! | `RATE_LIMIT_PER_MINUTE` | `120` | Invoices per minute per API key (a bulk request costs one per invoice) |
//! | `BULK_MAX_INVOICES` | `100` | Maximum invoices per bulk request |
//! | `MAX_CONCURRENT_COMPILES` | CPU count | Simultaneous Typst compilations |
//! | `CORS_ALLOWED_ORIGINS` | any | Comma-separated origins, or `*` |
//! | `ENABLE_GENERATE_PDF` | `true` | Set `false` to disable `POST /generate-pdf` (arbitrary templates) |

use std::sync::OnceLock;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

pub struct Config {
    pub bind_addr: String,
    pub api_keys: Vec<String>,
    pub database_url: Option<String>,
    pub redis_url: Option<String>,
    pub rate_limit_per_minute: u32,
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

impl Config {
    fn from_env() -> Self {
        let cors = env_list("CORS_ALLOWED_ORIGINS");
        let cors_origins = if cors.is_empty() || cors.iter().any(|o| o == "*") {
            None
        } else {
            Some(cors)
        };
        let cpus = std::thread::available_parallelism().map_or(2, |n| n.get());
        Self {
            bind_addr: std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".into()),
            api_keys: env_list("API_KEYS"),
            database_url: std::env::var("DATABASE_URL").ok().filter(|v| !v.trim().is_empty()),
            redis_url: std::env::var("REDIS_URL").ok().filter(|v| !v.trim().is_empty()),
            rate_limit_per_minute: env_parse("RATE_LIMIT_PER_MINUTE", 120u32).max(1),
            bulk_max_invoices: env_parse("BULK_MAX_INVOICES", 100usize).max(1),
            max_concurrent_compiles: env_parse("MAX_CONCURRENT_COMPILES", cpus).max(1),
            cors_origins,
            enable_generate_pdf: env_parse("ENABLE_GENERATE_PDF", true),
        }
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
