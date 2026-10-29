//! `/v1` API: fixed server-side template, API-key authentication, per-key rate
//! limit. The client sends plain invoice data; the template never leaves the server.

use crate::config;
use crate::invoice::{check_invoice, check_settings, file_stem, Errors, Invoice, Settings};
use crate::store::{self, Client};
use crate::{decode_assets, render_pdf, ApiError};
use axum::{
    extract::{rejection::JsonRejection, Extension, Json, Request},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::post,
    Router,
};
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    io::{Cursor, Write},
    sync::{Mutex, OnceLock},
    time::Instant,
};

/// The same template the frontend ships; compiled into the binary.
const INVOICE_TEMPLATE: &str = include_str!("../../frontend/src/template/invoice.typ");

pub fn router() -> Router {
    Router::new()
        .route("/invoices", post(single))
        .route("/invoices/bulk", post(bulk))
        .layer(middleware::from_fn(auth))
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    let mut diff = (a.len() != b.len()) as u8;
    for i in 0..a.len().max(b.len()) {
        diff |= a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0);
    }
    diff == 0
}

fn presented_key(req: &Request) -> Option<String> {
    let headers = req.headers();
    if let Some(value) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        let mut parts = value.splitn(2, ' ');
        if parts.next()?.eq_ignore_ascii_case("bearer") {
            return Some(parts.next()?.trim().to_string());
        }
    }
    headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim().to_string())
}

async fn auth(mut req: Request, next: Next) -> Response {
    let cfg = config::get();
    if cfg.api_keys.is_empty() && !store::has_database() {
        return ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "api_keys_not_configured",
            "the /v1 API is disabled: set API_KEYS or DATABASE_URL on the server",
        )
        .into_response();
    }
    let presented = presented_key(&req).unwrap_or_default();
    // Compare against every static key without early exit.
    let mut client = None;
    for (i, key) in cfg.api_keys.iter().enumerate() {
        if ct_eq(key.as_bytes(), presented.as_bytes()) {
            client = Some(Client {
                id: format!("env:{i}"),
                limit: cfg.rate_limit_per_minute,
            });
        }
    }
    if client.is_none() && !presented.is_empty() {
        client = store::lookup_key(&presented).await;
    }
    match client {
        Some(c) => {
            req.extensions_mut().insert(c);
            next.run(req).await
        }
        None => {
            let mut resp = ApiError::new(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "missing or invalid API key (use `Authorization: Bearer <key>` or `X-API-Key`)",
            )
            .into_response();
            resp.headers_mut()
                .insert(header::WWW_AUTHENTICATE, "Bearer".parse().unwrap());
            resp
        }
    }
}

struct Bucket {
    tokens: f64,
    last: Instant,
}

static BUCKETS: OnceLock<Mutex<HashMap<String, Bucket>>> = OnceLock::new();

fn limited(capacity: f64, wait: Option<u64>) -> ApiError {
    let mut err = ApiError::new(
        StatusCode::TOO_MANY_REQUESTS,
        "rate_limited",
        format!("rate limit of {capacity} invoices per minute reached"),
    );
    err.retry_after = wait;
    err
}

/// Token bucket per API key (`limit` tokens per minute, refilled continuously; every
/// invoice costs one token). Shared via Redis when available, otherwise per process.
async fn take_tokens(client: &Client, cost: usize) -> Result<(), ApiError> {
    let capacity = client.limit as f64;
    if cost as f64 > capacity {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            format!("{cost} invoices exceed the limit of {capacity} per minute"),
        ));
    }
    if let Some(decision) = store::redis_take(client, cost as u32).await {
        return decision.map_err(|wait| limited(capacity, Some(wait)));
    }
    let cost = cost as f64;
    let per_sec = capacity / 60.0;
    let mut map = BUCKETS.get_or_init(Default::default).lock().unwrap();
    let now = Instant::now();
    let bucket = map.entry(client.id.clone()).or_insert(Bucket {
        tokens: capacity,
        last: now,
    });
    bucket.tokens = (bucket.tokens + now.duration_since(bucket.last).as_secs_f64() * per_sec).min(capacity);
    bucket.last = now;
    if bucket.tokens >= cost {
        bucket.tokens -= cost;
        return Ok(());
    }
    let wait = ((cost - bucket.tokens) / per_sec).ceil().max(1.0) as u64;
    Err(limited(capacity, Some(wait)))
}

fn validation_error(errors: Errors) -> ApiError {
    let total = errors.0.len();
    let mut shown: Vec<String> = errors.0.into_iter().take(50).collect();
    if total > shown.len() {
        shown.push(format!("... and {} more", total - shown.len()));
    }
    ApiError::new(StatusCode::BAD_REQUEST, "validation_error", shown.join("; "))
}

fn bad_json(e: JsonRejection) -> ApiError {
    ApiError::new(e.status(), "invalid_request", e.body_text())
}

#[derive(Deserialize)]
struct SingleRequest {
    settings: Settings,
    invoice: Invoice,
}

#[derive(Deserialize)]
struct BulkRequest {
    settings: Settings,
    invoices: Vec<Invoice>,
}

fn logo_assets(logo: Option<String>) -> Result<Vec<(String, Vec<u8>)>, ApiError> {
    let map: HashMap<String, String> = logo.into_iter().map(|b| ("logo".to_string(), b)).collect();
    decode_assets(&map)
}

async fn single(
    Extension(client): Extension<Client>,
    payload: Result<Json<SingleRequest>, JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(req) = payload.map_err(bad_json)?;
    take_tokens(&client, 1).await?;

    let mut errors = Errors::default();
    let settings = check_settings(&req.settings, &mut errors);
    let invoice = check_invoice(&req.invoice, "invoice", &mut errors);
    if !errors.0.is_empty() {
        return Err(validation_error(errors));
    }
    let assets = logo_assets(settings.logo)?;
    let data = json!({ "settings": settings.data, "invoice": invoice });
    let pdf = render_pdf(INVOICE_TEMPLATE, data, assets).await?;
    let disposition = format!("attachment; filename=\"invoice-{}.pdf\"", file_stem(&req.invoice.number));
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/pdf".to_string()),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        pdf,
    )
        .into_response())
}

async fn bulk(
    Extension(client): Extension<Client>,
    payload: Result<Json<BulkRequest>, JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(req) = payload.map_err(bad_json)?;
    let max = config::get().bulk_max_invoices;
    if req.invoices.is_empty() || req.invoices.len() > max {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            format!("`invoices` needs 1 to {max} entries"),
        ));
    }
    take_tokens(&client, req.invoices.len()).await?;

    let mut errors = Errors::default();
    let settings = check_settings(&req.settings, &mut errors);
    let checked: Vec<_> = req
        .invoices
        .iter()
        .enumerate()
        .map(|(i, inv)| check_invoice(inv, &format!("invoices[{i}]"), &mut errors))
        .collect();
    if !errors.0.is_empty() {
        return Err(validation_error(errors));
    }
    let assets = logo_assets(settings.logo)?;

    let mut tasks = tokio::task::JoinSet::new();
    for (i, invoice) in checked.into_iter().enumerate() {
        let data = json!({ "settings": settings.data.clone(), "invoice": invoice });
        let assets = assets.clone();
        tasks.spawn(async move { (i, render_pdf(INVOICE_TEMPLATE, data, assets).await) });
    }
    let mut pdfs: Vec<Option<Vec<u8>>> = vec![None; req.invoices.len()];
    while let Some(joined) = tasks.join_next().await {
        let (i, result) = joined.map_err(|e| {
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "task_join_error", e.to_string())
        })?;
        match result {
            Ok(pdf) => pdfs[i] = Some(pdf),
            Err(mut e) => {
                e.details = format!("invoices[{i}]: {}", e.details);
                return Err(e);
            }
        }
    }

    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored);
    let mut used = HashSet::new();
    let zip_err = |e: String| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "zip_error", e);
    for (i, pdf) in pdfs.into_iter().enumerate() {
        let stem = file_stem(&req.invoices[i].number);
        let name = if used.insert(stem.clone()) {
            format!("invoice-{stem}.pdf")
        } else {
            format!("invoice-{stem}-{}.pdf", i + 1)
        };
        zip.start_file(name, options).map_err(|e| zip_err(e.to_string()))?;
        zip.write_all(&pdf.unwrap()).map_err(|e| zip_err(e.to_string()))?;
    }
    let bytes = zip.finish().map_err(|e| zip_err(e.to_string()))?.into_inner();
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/zip"),
            (header::CONTENT_DISPOSITION, "attachment; filename=\"invoices.zip\""),
        ],
        bytes,
    )
        .into_response())
}
