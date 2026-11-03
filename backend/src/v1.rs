//! `/v1` API: fixed server-side template, token authentication (free or paid), per-token
//! rate limit. The client sends plain invoice data; the template never leaves the server.

use crate::config;
use crate::documents::{self, Document, Kind};
use crate::einvoice;
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

/// Template data and virtual files (logo, e-invoice XML) of one invoice.
fn document(
    raw: &Settings,
    settings: serde_json::Value,
    invoice: &Invoice,
    mut checked: serde_json::Value,
    mut assets: Vec<(String, Vec<u8>)>,
) -> (serde_json::Value, Vec<(String, Vec<u8>)>) {
    let prepared = einvoice::prepare(raw, &settings, invoice, &mut checked, None);
    let mut data = json!({ "settings": settings, "invoice": checked });
    if let (Some(data), Some(extra)) = (data.as_object_mut(), prepared.extra.as_object()) {
        data.extend(extra.clone());
    }
    if let Some(xml) = prepared.xml {
        if xml.draft {
            tracing::warn!(event = "einvoice_draft", problems = ?xml.problems);
        }
        assets.push(("xml".to_string(), xml.bytes));
    }
    (data, assets)
}

/// Compiles a sample invoice once at startup so fonts, package modules and the
/// template's constant parts are cached before the first real request.
pub async fn warm_up() {
    for font in crate::invoice::FONTS {
        check_font(font).await;
    }
    sample_render(None).await;
    for kind in Kind::ALL {
        sample_document(kind).await;
    }
}

async fn sample_document(kind: Kind) {
    let raw_settings: Settings = serde_json::from_value(json!({
        "sender": {"name": "Warm-up", "address": "Street 1", "city": "12345 City"},
    }))
    .expect("valid warm-up settings");
    let raw_doc: Document = serde_json::from_value(json!({
        "number": "0", "date": "2026-01-01", "reference": "0", "subject": "Warm-up", "body": "Text",
        "recipient": {"name": "Warm-up", "address": "Street 2", "city": "12345 City"},
        "items": [{"description": "Item", "quantity": 1, "unit": "pcs", "price": 1, "taxRate": 19}],
    }))
    .expect("valid warm-up document");
    let mut errors = Errors::default();
    let settings = check_settings(&raw_settings, &mut errors);
    let doc = documents::check_document(kind, &raw_doc, false, &mut errors);
    if !errors.0.is_empty() {
        tracing::warn!(event = "warm_up_skipped", document = kind.slug(), errors = ?errors.0);
        return;
    }
    let (data, assets) = documents::build(kind, &raw_settings, settings.data, &raw_doc, doc, Vec::new());
    if let Err(e) = render_pdf(&kind.template(), data, assets).await {
        tracing::warn!(event = "warm_up_failed", document = kind.slug(), error = ?e.details);
    }
}

/// Renders the sample invoice; `font` overrides `settings.font` and the PDF bytes are returned.
async fn sample_render(font: Option<&str>) -> Option<Vec<u8>> {
    let raw_settings: Settings = serde_json::from_value(json!({
        "font": font,
        "sender": {"name": "Warm-up", "address": "Street 1", "city": "12345 City"},
        "bank": {"name": "Bank", "iban": "DE89370400440532013000", "bic": "COBADEFFXXX"},
        "zugferd": true,
    }))
    .expect("valid warm-up settings");
    let raw_invoice: Invoice = serde_json::from_value(json!({
        "number": "0",
        "date": "2026-01-01",
        "recipient": {"name": "Warm-up", "address": "Street 2", "city": "12345 City"},
        "items": [{"description": "Item", "quantity": 1, "unit": "pcs", "price": 1, "taxRate": 19}],
    }))
    .expect("valid warm-up invoice");
    let mut errors = Errors::default();
    let settings = check_settings(&raw_settings, &mut errors);
    let invoice = check_invoice(&raw_invoice, "invoice", &mut errors);
    if !errors.0.is_empty() {
        tracing::warn!(event = "warm_up_skipped", errors = ?errors.0);
        return None;
    }
    let (data, assets) = document(&raw_settings, settings.data, &raw_invoice, invoice, Vec::new());
    let started = std::time::Instant::now();
    match render_pdf(INVOICE_TEMPLATE, data, assets).await {
        Ok(pdf) => {
            if font.is_none() {
                tracing::info!(event = "warm_up", duration_ms = started.elapsed().as_secs_f64() * 1000.0);
            }
            Some(pdf)
        }
        Err(e) => {
            tracing::warn!(event = "warm_up_failed", error = ?e.details);
            None
        }
    }
}

/// Typst silently falls back to another font when a family is not installed; warn at startup
/// if a selectable font does not end up embedded in the PDF.
async fn check_font(font: &str) {
    let Some(pdf) = sample_render(Some(font)).await else { return };
    // The PDF names the embedded font by its PostScript name (NewCM10-Regular for New Computer Modern).
    let needle = if font == "New Computer Modern" { "NewCM".to_string() } else { font.replace(' ', "") };
    if !pdf.windows(needle.len()).any(|w| w == needle.as_bytes()) {
        tracing::warn!(event = "font_missing", font, "selectable font is not installed; PDFs fall back to another font");
    }
}

pub fn router() -> Router {
    let protected = Router::new()
        .route("/invoices", post(single))
        .route("/invoices/bulk", post(bulk))
        .route("/documents", post(document_single))
        .route("/documents/bulk", post(document_bulk))
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
        Err(_) => {
            crate::metrics::auth_failure("store_unavailable");
            store_unavailable().into_response()
        }
        Ok(None) => {
            crate::metrics::auth_failure("invalid_token");
            tracing::warn!(event = "auth_failed", reason = "invalid_token");
            unauthorized(
            "missing, invalid or expired token (use `Authorization: Bearer <token>` or `X-API-Key`)",
        )
        }
        Ok(Some(client)) if client.kind == store::Kind::Paid && !config::get().paid_tokens_enabled => {
            crate::metrics::auth_failure("paid_disabled");
            unauthorized("purchased tokens are not enabled on this server yet")
        }
        Ok(Some(client)) => {
            req.extensions_mut().insert(client.clone());
            let mut response = next.run(req).await;
            // Lets the outer access-log middleware see which token made the request
            response.extensions_mut().insert(client);
            response
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
        Ok(Err(wait)) => {
            crate::metrics::rate_limited(client);
            tracing::warn!(event = "rate_limited", token_id = %client.id, token_kind = client.kind.label(), token_plan = %client.plan, wait_secs = wait);
            Err(limited(client.limit, Some(wait)))
        }
        Err(_) => Err(store_unavailable()),
    }
}

/// PDFs created with a free token get a diagonal "Entwurf" / "Draft" watermark (by document language).
fn with_watermark(client: &Client, mut settings: serde_json::Value) -> serde_json::Value {
    if client.kind == store::Kind::Free {
        if let Some(obj) = settings.as_object_mut() {
            let english = obj.get("locale").and_then(|v| v.as_str()) == Some("en-de");
            obj.insert("watermark".into(), if english { "Draft" } else { "Entwurf" }.into());
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
    let (data, assets) = document(&req.settings, with_watermark(&client, settings.data), &req.invoice, invoice, assets);
    let started = std::time::Instant::now();
    let pdf = render_pdf(INVOICE_TEMPLATE, data, assets).await?;
    crate::metrics::observe_pdf(&client, started.elapsed().as_secs_f64(), pdf.len());
    crate::metrics::invoices_generated(&client, "single", 1);
    tracing::info!(
        event = "invoice_generated",
        endpoint = "single",
        invoices = 1,
        token_id = %client.id,
        token_kind = client.kind.label(),
        token_plan = %client.plan,
        duration_ms = started.elapsed().as_secs_f64() * 1000.0,
        size_bytes = pdf.len(),
    );
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

#[derive(Deserialize)]
struct DocumentRequest {
    #[serde(rename = "type")]
    kind: String,
    settings: Settings,
    document: Document,
}

/// Validates one document and renders it to PDF.
async fn render_document(
    client: &Client,
    kind: Kind,
    raw: &Settings,
    settings: &crate::invoice::CheckedSettings,
    doc: &Document,
    path: &str,
    errors: &mut Errors,
) -> Option<Result<Vec<u8>, ApiError>> {
    let english = settings.data["locale"] == "en-de";
    let before = errors.0.len();
    let checked = documents::check_document(kind, doc, english, errors);
    if errors.0.len() > before {
        for e in errors.0.iter_mut().skip(before) {
            *e = e.replacen("document", path, 1);
        }
        return None;
    }
    let assets = match logo_assets(settings.logo.clone()) {
        Ok(a) => a,
        Err(e) => return Some(Err(e)),
    };
    let (data, assets) = documents::build(kind, raw, with_watermark(client, settings.data.clone()), doc, checked, assets);
    Some(render_pdf(&kind.template(), data, assets).await)
}

fn parse_kind(value: &str) -> Result<Kind, ApiError> {
    Kind::parse(value).ok_or_else(|| {
        let allowed: Vec<&str> = Kind::ALL.iter().map(|k| k.slug()).collect();
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            format!("`type` must be one of: {}", allowed.join(", ")),
        )
    })
}

fn log_generated(client: &Client, endpoint: &str, count: usize, started: std::time::Instant, size: usize) {
    crate::metrics::invoices_generated(client, endpoint, count);
    tracing::info!(
        event = "invoice_generated",
        endpoint,
        invoices = count,
        token_id = %client.id,
        token_kind = client.kind.label(),
        token_plan = %client.plan,
        duration_ms = started.elapsed().as_secs_f64() * 1000.0,
        size_bytes = size,
    );
}

/// Credit note, offer, order confirmation, delivery note or letter (`type` selects the template).
async fn document_single(
    Extension(client): Extension<Client>,
    payload: Result<Json<DocumentRequest>, JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(req) = payload.map_err(bad_json)?;
    let kind = parse_kind(&req.kind)?;
    take_tokens(&client, 1).await?;

    let mut errors = Errors::default();
    let settings = check_settings(&req.settings, &mut errors);
    if !errors.0.is_empty() {
        return Err(validation_error(errors));
    }
    let started = std::time::Instant::now();
    let result = render_document(&client, kind, &req.settings, &settings, &req.document, "document", &mut errors).await;
    let Some(result) = result else { return Err(validation_error(errors)) };
    if !errors.0.is_empty() {
        return Err(validation_error(errors));
    }
    let pdf = result?;
    crate::metrics::observe_pdf(&client, started.elapsed().as_secs_f64(), pdf.len());
    log_generated(&client, kind.slug(), 1, started, pdf.len());
    let disposition = format!("attachment; filename=\"{}\"", documents::file_name(kind, &req.document));
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

#[derive(Deserialize)]
struct DocumentBulkRequest {
    #[serde(rename = "type")]
    kind: String,
    settings: Settings,
    documents: Vec<Document>,
}

/// Many documents of one type with shared settings -> ZIP.
async fn document_bulk(
    Extension(client): Extension<Client>,
    payload: Result<Json<DocumentBulkRequest>, JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(req) = payload.map_err(bad_json)?;
    let kind = parse_kind(&req.kind)?;
    let max = config::get().bulk_max_invoices;
    if req.documents.is_empty() || req.documents.len() > max {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            format!("`documents` needs 1 to {max} entries"),
        ));
    }
    take_tokens(&client, req.documents.len()).await?;

    let mut errors = Errors::default();
    let settings = check_settings(&req.settings, &mut errors);
    if !errors.0.is_empty() {
        return Err(validation_error(errors));
    }
    let started = std::time::Instant::now();
    let mut pdfs = Vec::new();
    for (i, doc) in req.documents.iter().enumerate() {
        let path = format!("documents[{i}]");
        match render_document(&client, kind, &req.settings, &settings, doc, &path, &mut errors).await {
            Some(Ok(pdf)) => pdfs.push(pdf),
            Some(Err(mut e)) => {
                e.details = format!("{path}: {}", e.details);
                return Err(e);
            }
            None => {}
        }
    }
    if !errors.0.is_empty() {
        return Err(validation_error(errors));
    }

    let size = pdfs.iter().map(Vec::len).sum::<usize>();
    log_generated(&client, &format!("{}-bulk", kind.slug()), pdfs.len(), started, size);
    crate::metrics::get().bulk_size.observe(pdfs.len() as f64);
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let mut used = HashSet::new();
    let zip_err = |e: String| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "zip_error", e);
    for (i, pdf) in pdfs.iter().enumerate() {
        zip.start_file(documents::zip_name(kind, &req.documents[i], i, &mut used), options)
            .map_err(|e| zip_err(e.to_string()))?;
        zip.write_all(pdf).map_err(|e| zip_err(e.to_string()))?;
    }
    let bytes = zip.finish().map_err(|e| zip_err(e.to_string()))?.into_inner();
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}.zip\"", kind.slug())),
        ],
        bytes,
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

    let started = std::time::Instant::now();
    let mut tasks = tokio::task::JoinSet::new();
    for (i, invoice) in checked.into_iter().enumerate() {
        let (data, assets) = document(
            &req.settings,
            with_watermark(&client, settings.data.clone()),
            &req.invoices[i],
            invoice,
            assets.clone(),
        );
        tasks.spawn(async move {
            let started = std::time::Instant::now();
            let result = render_pdf(INVOICE_TEMPLATE, data, assets).await;
            (i, result, started.elapsed().as_secs_f64())
        });
    }
    let mut pdfs: Vec<Option<Vec<u8>>> = vec![None; req.invoices.len()];
    while let Some(joined) = tasks.join_next().await {
        let (i, result, seconds) = joined.map_err(|e| {
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "task_join_error", e.to_string())
        })?;
        match result {
            Ok(pdf) => {
                crate::metrics::observe_pdf(&client, seconds, pdf.len());
                pdfs[i] = Some(pdf);
            }
            Err(mut e) => {
                e.details = format!("invoices[{i}]: {}", e.details);
                return Err(e);
            }
        }
    }

    crate::metrics::invoices_generated(&client, "bulk", pdfs.len());
    crate::metrics::get().bulk_size.observe(pdfs.len() as f64);
    tracing::info!(
        event = "invoice_generated",
        endpoint = "bulk",
        invoices = pdfs.len(),
        token_id = %client.id,
        token_kind = client.kind.label(),
        token_plan = %client.plan,
        duration_ms = started.elapsed().as_secs_f64() * 1000.0,
        size_bytes = pdfs.iter().flatten().map(Vec::len).sum::<usize>(),
    );
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn renders_every_document_type() {
        for kind in Kind::ALL {
            let settings: Settings = serde_json::from_value(json!({
                "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt", "email": "a@b.de", "vatId": "DE123456789"},
                "bank": {"iban": "DE89370400440532013000"},
                "footer": "Muster GmbH · Musterstr. 1",
            }))
            .unwrap();
            let raw: Document = serde_json::from_value(json!({
                "number": "2026-001", "date": "2026-01-31", "reference": "R-2026-007", "referenceDate": "2026-01-02",
                "validUntil": "2026-02-28", "deliveryDate": "2026-02-03", "subject": "Betreff \"x\"",
                "body": "Zeile 1\nZeile 2", "reason": "Falsche Menge", "intro": "Hallo", "closing": "Gruß",
                "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
                "items": [
                    {"description": "Beratung", "quantity": 8, "unit": "h", "price": 95, "taxRate": 19},
                    {"description": "Befreit", "quantity": 1, "unit": "pcs", "price": 10, "taxRate": 0},
                ],
            }))
            .unwrap();
            let mut errors = Errors::default();
            let s = check_settings(&settings, &mut errors);
            let doc = documents::check_document(kind, &raw, false, &mut errors);
            assert!(errors.0.is_empty(), "{:?}", errors.0);
            let (data, assets) = documents::build(kind, &settings, s.data, &raw, doc, Vec::new());
            let pdf = render_pdf(&kind.template(), data, assets).await.unwrap_or_else(|e| panic!("{}: {}", kind.slug(), e.details));
            assert!(pdf.starts_with(b"%PDF"));
            let has_xml = pdf.windows(12).any(|w| w == b"factur-x.xml");
            assert_eq!(has_xml, kind == Kind::CreditNote, "{}", kind.slug());
            if let Ok(dir) = std::env::var("PDF_OUT") {
                std::fs::write(format!("{dir}/{}.pdf", kind.slug()), pdf).unwrap();
            }
        }
    }
}
