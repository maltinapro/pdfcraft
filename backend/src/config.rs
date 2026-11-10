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
//! | `PAID_PLANS` | `starter=30,business=100,pro=300` | Paid plans as `name=invoices_per_minute` |
//! | `MOLLIE_API_KEY` | empty | Mollie API key (`test_…` / `live_…`); needed for checkout and the webhook |
//! | `MOLLIE_API_URL` | `https://api.mollie.com/v2` | Mollie API base URL (override for tests; plain http only for loopback) |
//! | `PUBLIC_URL` | empty | Public base URL of this backend; Mollie calls `<PUBLIC_URL>/v1/mollie/webhook` |
//! | `MOLLIE_REDIRECT_URL` | empty | Success page the customer returns to; `?order=<id>` is appended for `GET /v1/tokens/claim` |
//! | `PAID_PRICES` | empty | Offers as `plan:days=amount`, e.g. `starter:31=2.90,starter:365=24.00,business:31=9.90`; `POST /v1/checkout` only sells these |
//! | `PAID_CURRENCY` | `EUR` | Currency of `PAID_PRICES` |
//!
//! Purchases are active only if `PAID_TOKENS_ENABLED=true` and `MOLLIE_API_KEY`, `PUBLIC_URL`, `MOLLIE_REDIRECT_URL` and `PAID_PRICES` are all set (`Config::mollie_enabled`).
//! | `PAID_GRACE_DAYS` | `3` | Extra days after a paid subscription period before the token expires |
//! | `PAID_TOKEN_RETENTION_DAYS` | `365` | How long an expired paid token stays in Valkey (renewable by its id) |
//! | `INTERNETMARKE_ENABLED` | `false` | Feature flag: buy Deutsche Post stamps with the user's own Portokasse (`/v1/postage/*`) |
//! | `INTERNETMARKE_CLIENT_ID` / `_SECRET` | – | App credentials from the DHL developer portal (Internetmarke API) |
//! | `INTERNETMARKE_SHIPPING_URL` | production | Base URL of the Internetmarke API (override for tests) |
//! | `INTERNETMARKE_PRODUCTS_URL` | production | URL of the Deutsche Post product list (`profile=IM-PARTNER`) |
//! | `INTERNETMARKE_SANDBOX_SHIPPING_URL` | – | Test API: when set, **free** tokens (watermarked PDFs) buy test stamps there, paid tokens keep using the main API |
//! | `INTERNETMARKE_SANDBOX_PRODUCTS_URL` / `_CLIENT_ID` / `_CLIENT_SECRET` | main values | Overrides for the test API |
//! | `INTERNETMARKE_SANDBOX_USERNAME` / `_PASSWORD` | – | Shared test Portokasse login; free-token users then need no login of their own |
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
    pub mollie_api_key: Option<String>,
    pub mollie_api_url: String,
    pub public_url: Option<String>,
    pub mollie_redirect_url: Option<String>,
    pub paid_prices: Vec<Price>,
    pub paid_currency: String,
    pub paid_grace_days: u64,
    pub internetmarke_enabled: bool,
    pub internetmarke_client_id: Option<String>,
    pub internetmarke_client_secret: Option<String>,
    pub internetmarke_shipping_url: String,
    pub internetmarke_products_url: String,
    /// Test API for free tokens (their PDFs carry the draft watermark): none = free tokens use the main API.
    pub internetmarke_sandbox_shipping_url: Option<String>,
    pub internetmarke_sandbox_products_url: Option<String>,
    pub internetmarke_sandbox_client_id: Option<String>,
    pub internetmarke_sandbox_client_secret: Option<String>,
    /// Shared test Portokasse login: free-token users then need no login of their own.
    pub internetmarke_sandbox_username: Option<String>,
    pub internetmarke_sandbox_password: Option<String>,
    pub bulk_max_invoices: usize,
    pub max_concurrent_compiles: usize,
    pub cors_origins: Option<Vec<String>>,
}

fn env_opt(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
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

/// One purchasable offer: `days` of `plan` for `amount` (decimal string with two places).
#[derive(Clone, Debug, PartialEq)]
pub struct Price {
    pub plan: String,
    pub days: u64,
    pub amount: String,
}

fn parse_prices(raw: &str) -> Vec<Price> {
    raw.split(',')
        .filter_map(|entry| {
            let (offer, amount) = entry.split_once('=')?;
            let (plan, days) = offer.split_once(':')?;
            let days: u64 = days.trim().parse().ok().filter(|d| (1..=366).contains(d))?;
            let amount = amount.trim();
            let valid = matches!(amount.split_once('.'),
                Some((whole, cents)) if (1..=6).contains(&whole.len()) && cents.len() == 2
                    && whole.bytes().chain(cents.bytes()).all(|b| b.is_ascii_digit()));
            let plan = plan.trim().to_ascii_lowercase();
            (valid && !plan.is_empty() && amount != "0.00").then(|| Price { plan, days, amount: amount.into() })
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
            .unwrap_or_else(|| "starter=30,business=100,pro=300".into());
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
            mollie_api_key: env_opt("MOLLIE_API_KEY"),
            mollie_api_url: env_opt("MOLLIE_API_URL")
                .map(|v| v.trim().trim_end_matches('/').to_string())
                .unwrap_or_else(|| "https://api.mollie.com/v2".into()),
            public_url: env_opt("PUBLIC_URL").map(|v| v.trim().trim_end_matches('/').to_string()),
            mollie_redirect_url: env_opt("MOLLIE_REDIRECT_URL"),
            paid_prices: parse_prices(&std::env::var("PAID_PRICES").unwrap_or_default()),
            paid_currency: env_opt("PAID_CURRENCY").map_or_else(|| "EUR".into(), |c| c.trim().to_ascii_uppercase()),
            paid_grace_days: env_parse("PAID_GRACE_DAYS", 3u64),
            internetmarke_enabled: env_parse("INTERNETMARKE_ENABLED", false),
            internetmarke_client_id: std::env::var("INTERNETMARKE_CLIENT_ID").ok().filter(|v| !v.trim().is_empty()),
            internetmarke_client_secret: std::env::var("INTERNETMARKE_CLIENT_SECRET").ok().filter(|v| !v.trim().is_empty()),
            internetmarke_shipping_url: std::env::var("INTERNETMARKE_SHIPPING_URL")
                .ok()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| crate::internetmarke::DEFAULT_SHIPPING_URL.into()),
            internetmarke_products_url: std::env::var("INTERNETMARKE_PRODUCTS_URL")
                .ok()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| crate::internetmarke::DEFAULT_PRODUCTS_URL.into()),
            internetmarke_sandbox_shipping_url: env_opt("INTERNETMARKE_SANDBOX_SHIPPING_URL"),
            internetmarke_sandbox_products_url: env_opt("INTERNETMARKE_SANDBOX_PRODUCTS_URL"),
            internetmarke_sandbox_client_id: env_opt("INTERNETMARKE_SANDBOX_CLIENT_ID"),
            internetmarke_sandbox_client_secret: env_opt("INTERNETMARKE_SANDBOX_CLIENT_SECRET"),
            internetmarke_sandbox_username: env_opt("INTERNETMARKE_SANDBOX_USERNAME"),
            internetmarke_sandbox_password: env_opt("INTERNETMARKE_SANDBOX_PASSWORD"),
            bulk_max_invoices: env_parse("BULK_MAX_INVOICES", 100usize).max(1),
            max_concurrent_compiles: env_parse("MAX_CONCURRENT_COMPILES", cpus).max(1),
            cors_origins,
        }
    }

    /// Purchases through Mollie are offered only when the feature flag and everything the
    /// checkout needs are configured; otherwise every purchase endpoint answers 404.
    pub fn mollie_enabled(&self) -> bool {
        self.paid_tokens_enabled
            && self.mollie_api_key.is_some()
            && self.public_url.is_some()
            && self.mollie_redirect_url.is_some()
            && !self.paid_prices.is_empty()
    }

    pub fn price(&self, plan: &str, days: u64) -> Option<&Price> {
        self.paid_prices.iter().find(|p| p.plan == plan && p.days == days)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prices_accept_only_well_formed_offers() {
        let prices = parse_prices("Starter:31=19.00, pro:1=2.50, bad:0=1.00, bad:5=1, bad=3.00, free:7=0.00, x:7=1.5");
        assert_eq!(
            prices,
            vec![
                Price { plan: "starter".into(), days: 31, amount: "19.00".into() },
                Price { plan: "pro".into(), days: 1, amount: "2.50".into() },
            ]
        );
    }
}
