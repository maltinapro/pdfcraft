//! `/v1` API: fixed server-side template, token authentication (free or paid), per-token
//! rate limit. The client sends plain invoice data; the template never leaves the server.

use crate::config;
use crate::invoice::{check_invoice, check_settings, file_stem, Errors, Invoice, Settings};
use crate::store::{self, Client};
use crate::{decode_assets, render_pdf, ApiError};
use axum::{
    extract::{rejection::JsonRejection, Extension, Json, Request},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    io::{Cursor, Write},
};

/// The same template the frontend ships; compiled into the binary.
const INVOICE_TEMPLATE: &str = include_str!("../../frontend/src/template/invoice.typ");

pub fn router() -> Router {
    let protected = Router::new()
        .route("/invoices", post(single))
        .route("/invoices/bulk", post(bulk))
        .layer(middleware::from_fn(auth));
    // Free tokens are issued against an Anubis pass instead of a token
    // Purchase hand-over (Stripe): only answers while PAID_TOKENS_ENABLED
    Router::new()
        .route("/free-token", post(crate::free::issue))
        .route("/stripe/webhook", post(crate::stripe::webhook))
        .route("/tokens/claim", get(crate::stripe::claim))
        .merge(protected)
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

fn store_unavailable() -> ApiError {
    ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "store_unavailable",
        "the token store (Valkey) is not configured or not reachable",
    )
}

fn unauthorized(details: &'static str) -> Response {
    let mut resp = ApiError::new(StatusCode::UNAUTHORIZED, "unauthorized", details).into_response();
    resp.headers_mut()
        .insert(header::WWW_AUTHENTICATE, "Bearer".parse().unwrap());
    resp
}

async fn auth(mut req: Request, next: Next) -> Response {
    if !store::is_configured() {
        return store_unavailable().into_response();
    }
    let presented = presented_key(&req).unwrap_or_default();
    match store::lookup(&presented).await {
        Err(_) => store_unavailable().into_response(),
        Ok(None) => unauthorized(
            "missing, invalid or expired token (use `Authorization: Bearer <token>` or `X-API-Key`)",
        ),
        Ok(Some(client)) if client.kind == store::Kind::Paid && !config::get().paid_tokens_enabled => {
            unauthorized("purchased tokens are not enabled on this server yet")
        }
        Ok(Some(client)) => {
            req.extensions_mut().insert(client);
            next.run(req).await
        }
    }
}

fn limited(capacity: u32, wait: Option<u64>) -> ApiError {
    let mut err = ApiError::new(
        StatusCode::TOO_MANY_REQUESTS,
        "rate_limited",
        format!("rate limit of {capacity} invoices per minute reached"),
    );
    err.retry_after = wait;
    err
}

/// Token bucket per token (`limit` invoices per minute, refilled continuously; every
/// invoice costs one). The state lives in Valkey, so it is shared across instances.
async fn take_tokens(client: &Client, cost: usize) -> Result<(), ApiError> {
    if cost > client.limit as usize {
        return Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            format!("{cost} invoices exceed the limit of {} per minute", client.limit),
        ));
    }
    match store::take(client, cost as u32).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(wait)) => Err(limited(client.limit, Some(wait))),
        Err(_) => Err(store_unavailable()),
    }
}

/// PDFs created with a free token get a diagonal "Entwurf" (draft) watermark.
fn with_watermark(client: &Client, mut settings: serde_json::Value) -> serde_json::Value {
    if client.kind == store::Kind::Free {
        if let Some(obj) = settings.as_object_mut() {
            obj.insert("watermark".into(), "Entwurf".into());
        }
    }
    settings
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
    let data = json!({ "settings": with_watermark(&client, settings.data), "invoice": invoice });
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
        let data = json!({ "settings": with_watermark(&client, settings.data.clone()), "invoice": invoice });
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
