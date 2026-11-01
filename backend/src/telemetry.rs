//! Structured logging (JSON lines on stdout, ingested by Loki) and the per-request
//! access log. No customer data and no client IPs are logged: only route templates,
//! status codes, timings and the (non-secret) token id/kind/plan.

use crate::store::Client;
use axum::{
    extract::{MatchedPath, Request},
    middleware::Next,
    response::Response,
};
use std::time::Instant;
use tracing_subscriber::EnvFilter;

/// JSON logs on stdout; level via `RUST_LOG` (default `info`), format via `LOG_FORMAT=text`
/// for readable local output.
pub fn init_logging() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let builder = tracing_subscriber::fmt().with_env_filter(filter).with_target(true);
    if std::env::var("LOG_FORMAT").is_ok_and(|v| v.eq_ignore_ascii_case("text")) {
        builder.init();
    } else {
        builder.json().flatten_event(true).with_current_span(false).with_span_list(false).init();
    }
}

/// Matched route template (e.g. `/v1/invoices`), never the raw path, so it is safe as a
/// log field and later as a metric label.
fn route_of(req: &Request) -> String {
    req.extensions()
        .get::<MatchedPath>()
        .map(|m| m.as_str().to_owned())
        .unwrap_or_else(|| "unmatched".to_owned())
}

/// Access log: one line per request. Health probes are logged at debug level only.
pub async fn access_log(req: Request, next: Next) -> Response {
    let started = Instant::now();
    let method = req.method().to_string();
    let route = route_of(&req);
    let response = next.run(req).await;
    let status = response.status().as_u16();
    let duration_ms = started.elapsed().as_secs_f64() * 1000.0;
    let client = response.extensions().get::<Client>();
    let (token_id, token_kind, token_plan) = match client {
        Some(c) => (Some(c.id.as_str()), Some(c.kind.label()), Some(c.plan.as_str())),
        None => (None, None, None),
    };
    let token_age_s = client.and_then(|c| c.created).map(|t| crate::store::now().saturating_sub(t));
    if route == "/health" {
        tracing::debug!(event = "http_request", method, route, status, duration_ms);
    } else {
        tracing::info!(event = "http_request", method, route, status, duration_ms, token_id, token_kind, token_plan, token_age_s);
    }
    response
}
