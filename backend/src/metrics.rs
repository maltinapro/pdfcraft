//! Prometheus metrics in the OpenMetrics text format, served on a separate listener
//! (`METRICS_ADDR`, default `0.0.0.0:9090`) that is not part of the public API/ingress.
//!
//! Label policy (cardinality): `kind` (free/paid), `plan` (free + the configured paid
//! plans), route *templates*, status codes and error codes are bounded. A per-token label
//! (`token_id`) exists only for **paid** tokens (one per customer); free tokens (one per
//! browser visit) are aggregated.

use crate::store::{Client, Kind};
use axum::{http::header, response::IntoResponse, routing::get as route_get, Router};
use prometheus_client::{
    encoding::{text::encode, EncodeLabelSet},
    metrics::{counter::Counter, family::Family, gauge::Gauge, histogram::Histogram},
    registry::{Registry, Unit},
};
use std::sync::OnceLock;

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct HttpLabels {
    pub method: String,
    pub route: String,
    pub status: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct HttpDurationLabels {
    pub method: String,
    pub route: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct TokenLabels {
    pub kind: String,
    pub plan: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct InvoiceLabels {
    pub kind: String,
    pub plan: String,
    pub endpoint: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct PaidTokenLabels {
    pub token_id: String,
    pub plan: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct KindLabels {
    pub kind: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct ResultLabels {
    pub result: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct ReasonLabels {
    pub reason: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct CodeLabels {
    pub code: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct StripeLabels {
    pub event: String,
    pub result: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct VersionLabels {
    pub version: String,
}

pub struct Metrics {
    pub http_requests: Family<HttpLabels, Counter>,
    pub http_duration: Family<HttpDurationLabels, Histogram>,
    pub api_errors: Family<CodeLabels, Counter>,
    pub auth_failures: Family<ReasonLabels, Counter>,
    pub tokens_created: Family<TokenLabels, Counter>,
    pub free_token_requests: Family<ResultLabels, Counter>,
    pub tokens_active: Family<TokenLabels, Gauge>,
    pub invoices: Family<InvoiceLabels, Counter>,
    pub paid_token_invoices: Family<PaidTokenLabels, Counter>,
    pub pdf_generation: Family<TokenLabels, Histogram>,
    pub pdf_size: Family<KindLabels, Histogram>,
    pub bulk_size: Histogram,
    pub token_age: Family<TokenLabels, Histogram>,
    pub rate_limited: Family<TokenLabels, Counter>,
    pub queue_wait: Histogram,
    pub typst_compile: Histogram,
    pub slots_total: Gauge,
    pub slots_in_use: Gauge,
    pub store_errors: Counter,
    pub stripe_events: Family<StripeLabels, Counter>,
}

struct State {
    metrics: Metrics,
    registry: Registry,
}

static STATE: OnceLock<State> = OnceLock::new();

fn buckets(values: &[f64]) -> impl Iterator<Item = f64> {
    values.to_vec().into_iter()
}

/// Latency buckets (seconds).
const LATENCY: &[f64] = &[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0];
/// Token age when used: 1 min … 1 year (free tokens live 12 h, paid ones weeks/months).
const TOKEN_AGE: &[f64] = &[
    60.0, 300.0, 900.0, 3_600.0, 7_200.0, 14_400.0, 28_800.0, 43_200.0, 86_400.0, 604_800.0,
    2_592_000.0, 7_776_000.0, 31_536_000.0,
];
const PDF_SIZE: &[f64] = &[10e3, 25e3, 50e3, 100e3, 250e3, 500e3, 1e6, 2.5e6, 5e6];
const BATCH: &[f64] = &[1.0, 2.0, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0];

fn build() -> State {
    let m = Metrics {
        http_requests: Family::default(),
        http_duration: Family::new_with_constructor(|| Histogram::new(buckets(LATENCY))),
        api_errors: Family::default(),
        auth_failures: Family::default(),
        tokens_created: Family::default(),
        free_token_requests: Family::default(),
        tokens_active: Family::default(),
        invoices: Family::default(),
        paid_token_invoices: Family::default(),
        pdf_generation: Family::new_with_constructor(|| Histogram::new(buckets(LATENCY))),
        pdf_size: Family::new_with_constructor(|| Histogram::new(buckets(PDF_SIZE))),
        bulk_size: Histogram::new(buckets(BATCH)),
        token_age: Family::new_with_constructor(|| Histogram::new(buckets(TOKEN_AGE))),
        rate_limited: Family::default(),
        queue_wait: Histogram::new(buckets(LATENCY)),
        typst_compile: Histogram::new(buckets(LATENCY)),
        slots_total: Gauge::default(),
        slots_in_use: Gauge::default(),
        store_errors: Counter::default(),
        stripe_events: Family::default(),
    };

    let mut r = Registry::with_prefix("pdfcraft");
    r.register("http_requests", "HTTP requests by method, route template and status", m.http_requests.clone());
    r.register_with_unit("http_request_duration", "HTTP request duration", Unit::Seconds, m.http_duration.clone());
    r.register("api_errors", "Error responses by API error code", m.api_errors.clone());
    r.register("auth_failures", "Rejected authentications by reason", m.auth_failures.clone());
    r.register("tokens_created", "Tokens created by kind and plan", m.tokens_created.clone());
    r.register("free_token_requests", "Requests to /v1/free-token by result", m.free_token_requests.clone());
    r.register("tokens_active", "Currently valid tokens by kind and plan (refreshed every minute)", m.tokens_active.clone());
    r.register("invoices", "Invoices (PDFs) generated by token kind, plan and endpoint", m.invoices.clone());
    r.register("paid_token_invoices", "Invoices generated per paid token (one series per customer token)", m.paid_token_invoices.clone());
    r.register_with_unit("pdf_generation", "Time to generate one PDF including queueing for a compile slot", Unit::Seconds, m.pdf_generation.clone());
    r.register_with_unit("pdf_size", "Size of generated PDFs", Unit::Bytes, m.pdf_size.clone());
    r.register("bulk_invoices", "Invoices per bulk request", m.bulk_size.clone());
    r.register_with_unit("token_age_at_use", "Age of the token (since creation) whenever it generated a PDF", Unit::Seconds, m.token_age.clone());
    r.register("rate_limited", "Requests rejected by the rate limit", m.rate_limited.clone());
    r.register_with_unit("compile_queue_wait", "Time waiting for a free compile slot", Unit::Seconds, m.queue_wait.clone());
    r.register_with_unit("typst_compile", "Typst compile + PDF export time (without queueing)", Unit::Seconds, m.typst_compile.clone());
    r.register("compile_slots", "Configured simultaneous compilations (MAX_CONCURRENT_COMPILES)", m.slots_total.clone());
    r.register("compile_slots_in_use", "Compilations running right now", m.slots_in_use.clone());
    r.register("store_errors", "Failed Valkey operations", m.store_errors.clone());
    r.register("stripe_events", "Stripe webhook events by type and result", m.stripe_events.clone());

    let info: Family<VersionLabels, Gauge> = Family::default();
    info.get_or_create(&VersionLabels { version: env!("CARGO_PKG_VERSION").into() }).set(1);
    r.register("build_info", "Backend version", info);

    State { metrics: m, registry: r }
}

pub fn get() -> &'static Metrics {
    &STATE.get_or_init(build).metrics
}

fn client_labels(client: &Client) -> TokenLabels {
    TokenLabels { kind: client.kind.label().into(), plan: client.plan.clone() }
}

/// Counts generated invoices for a token and records usage relative to the token's age.
pub fn invoices_generated(client: &Client, endpoint: &str, count: usize) {
    let m = get();
    m.invoices
        .get_or_create(&InvoiceLabels { kind: client.kind.label().into(), plan: client.plan.clone(), endpoint: endpoint.into() })
        .inc_by(count as u64);
    if client.kind == Kind::Paid {
        m.paid_token_invoices
            .get_or_create(&PaidTokenLabels { token_id: client.id.clone(), plan: client.plan.clone() })
            .inc_by(count as u64);
    }
    if let Some(created) = client.created {
        let age = crate::store::now().saturating_sub(created) as f64;
        let hist = m.token_age.get_or_create(&client_labels(client));
        for _ in 0..count {
            hist.observe(age);
        }
    }
}

pub fn observe_pdf(client: &Client, seconds: f64, size_bytes: usize) {
    let m = get();
    m.pdf_generation.get_or_create(&client_labels(client)).observe(seconds);
    m.pdf_size.get_or_create(&KindLabels { kind: client.kind.label().into() }).observe(size_bytes as f64);
}

pub fn rate_limited(client: &Client) {
    get().rate_limited.get_or_create(&client_labels(client)).inc();
}

pub fn http_request(method: &str, route: &str, status: u16, seconds: f64) {
    let m = get();
    m.http_requests
        .get_or_create(&HttpLabels { method: method.into(), route: route.into(), status: status.to_string() })
        .inc();
    m.http_duration
        .get_or_create(&HttpDurationLabels { method: method.into(), route: route.into() })
        .observe(seconds);
}

pub fn api_error(code: &str) {
    get().api_errors.get_or_create(&CodeLabels { code: code.into() }).inc();
}

pub fn auth_failure(reason: &str) {
    get().auth_failures.get_or_create(&ReasonLabels { reason: reason.into() }).inc();
}

pub fn free_token_request(result: &str) {
    get().free_token_requests.get_or_create(&ResultLabels { result: result.into() }).inc();
}

pub fn store_error() {
    get().store_errors.inc();
}

pub fn token_created(kind: Kind, plan: &str) {
    get().tokens_created.get_or_create(&TokenLabels { kind: kind.label().into(), plan: plan.into() }).inc();
}

pub fn stripe_event(event: &str, result: &str) {
    get().stripe_events.get_or_create(&StripeLabels { event: event.into(), result: result.into() }).inc();
}

fn render() -> String {
    let state = STATE.get_or_init(build);
    let total = crate::config::get().max_concurrent_compiles as i64;
    state.metrics.slots_total.set(total);
    state.metrics.slots_in_use.set(total - crate::compile_slots_available() as i64);
    let mut out = String::new();
    encode(&mut out, &state.registry).expect("encoding into a String cannot fail");
    out
}

async fn handler() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "application/openmetrics-text; version=1.0.0; charset=utf-8")],
        render(),
    )
}

/// Serves `GET /metrics` on a dedicated address; it is never routed through the ingress.
pub async fn serve(addr: String) {
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!(event = "metrics_bind_failed", addr, error = %e);
            return;
        }
    };
    tracing::info!(event = "metrics_listening", listen = %addr);
    let app = Router::new().route("/metrics", route_get(handler));
    if let Err(e) = axum::serve(listener, app).await {
        tracing::error!(event = "metrics_server_failed", error = %e);
    }
}

/// Refreshes the `tokens_active` gauge from Valkey once a minute.
pub async fn refresh_active_tokens_forever() {
    loop {
        if let Ok(counts) = crate::store::count_active_tokens().await {
            let g = &get().tokens_active;
            g.clear();
            for ((kind, plan), n) in counts {
                g.get_or_create(&TokenLabels { kind, plan }).set(n as i64);
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
    }
}
