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
use utoipa::ToSchema;
use std::{
    collections::{HashMap, HashSet},
    io::{Cursor, Write},
};

mod warm_up;
pub use warm_up::warm_up;

/// The same template the frontend ships; compiled into the binary.
const INVOICE_TEMPLATE: &str = include_str!("../../frontend/src/template/invoice.typ");

/// Virtual files of one render job (logo, signature, stamp, e-invoice XML) by name.
type Assets = Vec<(String, Vec<u8>)>;

/// Template data and virtual files (logo, e-invoice XML) of one invoice.
fn invoice_data(
    raw: &Settings,
    settings: serde_json::Value,
    invoice: &Invoice,
    mut checked: serde_json::Value,
    mut assets: Assets,
) -> (serde_json::Value, Assets) {
    crate::postage::attach(invoice.postage.as_ref(), &mut assets);
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

pub fn router() -> Router {
    let protected = Router::new()
        .route("/invoices", post(single))
        .route("/invoices/bulk", post(bulk))
        .route("/documents", post(document_single))
        .route("/documents/bulk", post(document_bulk))
        .route("/postage/products", get(crate::internetmarke::list_products))
        .route("/postage/stamps", post(crate::internetmarke::buy_stamp))
        .route("/postage/stamps/bulk", post(crate::internetmarke::buy_stamps_bulk))
        .route("/postage/stamps/recover", post(crate::internetmarke::recover_stamps))
        .route("/token", get(crate::mollie::token_info))
        .route("/subscription/cancel", post(crate::mollie::cancel_subscription))
        .layer(middleware::from_fn(auth));
    // Free tokens are issued against an Anubis pass instead of a token
    // Purchases (Mollie): only answer while `Config::mollie_enabled`
    Router::new()
        .route("/free-token", post(crate::free::issue))
        .route("/checkout", post(crate::mollie::checkout))
        .route("/checkout/offers", get(crate::mollie::offers))
        .route("/mollie/webhook", post(crate::mollie::webhook))
        .route("/tokens/claim", get(crate::mollie::claim))
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
pub(crate) async fn take_tokens(client: &Client, cost: usize) -> Result<(), ApiError> {
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

/// One invoice with its settings.
#[derive(Deserialize, ToSchema)]
pub(crate) struct InvoiceRequest {
    settings: Settings,
    invoice: Invoice,
}

/// Many invoices with shared settings.
#[derive(Deserialize, ToSchema)]
pub(crate) struct InvoiceBulkRequest {
    settings: Settings,
    /// Between 1 and `bulkMax` of the token (see `GET /v1/token`).
    #[schema(min_items = 1)]
    invoices: Vec<Invoice>,
}

/// The logo and the signature of the settings as virtual files (`assets.logo`, `assets.signature`).
fn settings_assets(settings: &crate::invoice::CheckedSettings) -> Result<Assets, ApiError> {
    let mut map = HashMap::new();
    for (key, value) in [("logo", &settings.logo), ("signature", &settings.signature)] {
        if let Some(encoded) = value {
            map.insert(key.to_string(), encoded.clone());
        }
    }
    decode_assets(&map)
}

/// Create one invoice (PDF)
///
/// Renders one invoice as PDF/A-3b. With `settings.zugferd` (default `true`) the PDF carries the
/// e-invoice XML (`factur-x.xml` for `en16931`, `xrechnung.xml` for `xrechnung`). If the data is not
/// sufficient for a valid e-invoice, `invoice-draft.xml` is attached instead. Costs one rate-limit unit.
#[utoipa::path(
    post,
    path = "/v1/invoices",
    tag = "Invoices",
    operation_id = "createInvoice",
    request_body = InvoiceRequest,
    responses((status = 200, description = "The PDF (PDF/A-3b).", content_type = "application/pdf", body = Vec<u8>, headers(("Content-Disposition" = String, description = "`attachment; filename=\"…\"` with the suggested file name."))))
)]
pub(crate) async fn single(
    Extension(client): Extension<Client>,
    payload: Result<Json<InvoiceRequest>, JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(req) = payload.map_err(bad_json)?;
    take_tokens(&client, 1).await?;

    let mut errors = Errors::default();
    let settings = check_settings(&req.settings, &mut errors);
    let invoice = check_invoice(&req.invoice, "invoice", &mut errors);
    if !errors.0.is_empty() {
        return Err(validation_error(errors));
    }
    let assets = settings_assets(&settings)?;
    let (data, assets) = invoice_data(&req.settings, with_watermark(&client, settings.data), &req.invoice, invoice, assets);
    let started = std::time::Instant::now();
    let pdf = render_pdf(INVOICE_TEMPLATE, data, assets).await?;
    crate::metrics::observe_pdf(&client, started.elapsed().as_secs_f64(), pdf.len());
    log_generated(&client, "single", 1, started, pdf.len());
    Ok(pdf_response(pdf, &format!("invoice-{}.pdf", file_stem(&req.invoice.number))))
}

/// One document of the given type with its settings.
#[derive(Deserialize, ToSchema)]
pub(crate) struct DocumentRequest {
    #[serde(rename = "type")]
    #[schema(value_type = Kind, required = true)]
    kind: String,
    settings: Settings,
    document: Document,
}

/// Validates one document and builds its template data. Problems are added to `errors`
/// with `path` (e.g. `documents[2]`) instead of `document`.
fn prepare_document(
    kind: Kind,
    raw: &Settings,
    settings: serde_json::Value,
    assets: Assets,
    doc: &Document,
    path: &str,
    errors: &mut Errors,
) -> Option<(serde_json::Value, Assets)> {
    let english = settings["locale"] == "en-de";
    let before = errors.0.len();
    let checked = documents::check_document(kind, doc, english, errors);
    if errors.0.len() > before {
        for e in errors.0.iter_mut().skip(before) {
            *e = e.replacen("document", path, 1);
        }
        return None;
    }
    Some(documents::build(kind, raw, settings, doc, checked, assets))
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

/// Bulk requests need between 1 and the plan's maximum (`BULK_MAX_BY_PLAN`) entries.
fn check_bulk_size(client: &Client, count: usize, field: &str) -> Result<(), ApiError> {
    let max = config::get().bulk_max(&client.plan);
    if count == 0 || count > max {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            format!("`{field}` needs 1 to {max} entries"),
        ));
    }
    Ok(())
}

fn pdf_response(pdf: Vec<u8>, file_name: &str) -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/pdf".to_string()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{file_name}\"")),
        ],
        pdf,
    )
        .into_response()
}

/// Makes `name` unique within one ZIP by inserting the position before `.pdf` when it repeats.
fn unique_name(name: String, index: usize, used: &mut HashSet<String>) -> String {
    let mut candidate = name.clone();
    let mut n = index + 1;
    while !used.insert(candidate.clone()) {
        candidate = format!("{}-{n}.pdf", name.trim_end_matches(".pdf"));
        n += 1;
    }
    candidate
}

/// Stores the PDFs uncompressed (they are compressed already) in a ZIP; `names` has one entry per PDF.
fn zip_response(pdfs: &[Vec<u8>], names: Vec<String>, archive: &str) -> Result<Response, ApiError> {
    let zip_err = |e: String| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "zip_error", e);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let mut used = HashSet::new();
    for (i, (pdf, name)) in pdfs.iter().zip(names).enumerate() {
        zip.start_file(unique_name(name, i, &mut used), options)
            .map_err(|e| zip_err(e.to_string()))?;
        zip.write_all(pdf).map_err(|e| zip_err(e.to_string()))?;
    }
    let bytes = zip.finish().map_err(|e| zip_err(e.to_string()))?.into_inner();
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{archive}.zip\"")),
        ],
        bytes,
    )
        .into_response())
}

/// Renders all jobs at the same time (the compile semaphore limits the real parallelism) and
/// returns the PDFs in job order. The first failure is reported with its position, e.g. `invoices[2]`.
async fn render_all(
    client: &Client,
    template: &'static str,
    label: &str,
    jobs: Vec<(serde_json::Value, Assets)>,
) -> Result<Vec<Vec<u8>>, ApiError> {
    let mut tasks = tokio::task::JoinSet::new();
    for (i, (data, assets)) in jobs.into_iter().enumerate() {
        tasks.spawn(async move {
            let started = std::time::Instant::now();
            let result = render_pdf(template, data, assets).await;
            (i, result, started.elapsed().as_secs_f64())
        });
    }
    let mut pdfs: Vec<Vec<u8>> = vec![Vec::new(); tasks.len()];
    while let Some(joined) = tasks.join_next().await {
        let (i, result, seconds) = joined
            .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "task_join_error", e.to_string()))?;
        match result {
            Ok(pdf) => {
                crate::metrics::observe_pdf(client, seconds, pdf.len());
                pdfs[i] = pdf;
            }
            Err(mut e) => {
                e.details = format!("{label}[{i}]: {}", e.details);
                return Err(e);
            }
        }
    }
    Ok(pdfs)
}

/// Create one document (PDF)
///
/// Credit note (Stornorechnung), offer, order confirmation, delivery note or letter; `type` selects the
/// template. Same authentication, rate limit (one unit per PDF), watermark rules and error format as
/// `POST /v1/invoices`. Only `settings.sender`, the logo, signature, accent color, font, locale and footer
/// are used. A credit note carries an EN 16931 / XRechnung credit-note XML (TypeCode 381) when
/// `settings.zugferd` is on.
///
/// Required `document` fields by `type`:
///
/// | `type` | Required | Optional |
/// | --- | --- | --- |
/// | `credit-note` | `number`, `date`, `recipient`, `items`, `reference` (the cancelled invoice) | `referenceDate`, `reason`, `closing` |
/// | `offer` | `number`, `date`, `recipient`, `items` | `validUntil`, `reference`, `intro`, `closing` |
/// | `order` | `number`, `date`, `recipient`, `items` | `deliveryDate`, `reference`, `intro`, `closing` |
/// | `delivery-note` | `number`, `date`, `recipient`, `items` (shown without prices) | `deliveryDate`, `reference`, `intro`, `closing` |
/// | `letter` | `date`, `recipient`, `subject`, `body` | `reference`, `closing` |
#[utoipa::path(
    post,
    path = "/v1/documents",
    tag = "Documents",
    operation_id = "createDocument",
    request_body = DocumentRequest,
    responses((status = 200, description = "The PDF (PDF/A-3b).", content_type = "application/pdf", body = Vec<u8>, headers(("Content-Disposition" = String, description = "`attachment; filename=\"…\"` with the suggested file name."))))
)]
pub(crate) async fn document_single(
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
    let assets = settings_assets(&settings)?;
    let Some((data, assets)) = prepare_document(
        kind,
        &req.settings,
        with_watermark(&client, settings.data),
        assets,
        &req.document,
        "document",
        &mut errors,
    ) else {
        return Err(validation_error(errors));
    };
    let started = std::time::Instant::now();
    let pdf = render_pdf(kind.template(), data, assets).await?;
    crate::metrics::observe_pdf(&client, started.elapsed().as_secs_f64(), pdf.len());
    log_generated(&client, kind.slug(), 1, started, pdf.len());
    Ok(pdf_response(pdf, &documents::file_name(kind, &req.document)))
}

/// Many documents of one type with shared settings.
#[derive(Deserialize, ToSchema)]
pub(crate) struct DocumentBulkRequest {
    #[serde(rename = "type")]
    #[schema(value_type = Kind, required = true)]
    kind: String,
    settings: Settings,
    /// Between 1 and `bulkMax` of the token (see `GET /v1/token`).
    #[schema(min_items = 1)]
    documents: Vec<Document>,
}

/// Create many documents of one type (ZIP of PDFs)
///
/// Renders many documents of one `type` with shared settings and returns a ZIP of PDFs named
/// `<type>-<number>.pdf`. Any validation error rejects the whole request and names the entry
/// (`documents[2]: …`). The number of documents per request depends on the plan (`bulkMax` of
/// `GET /v1/token`). Costs one rate-limit unit per document.
#[utoipa::path(
    post,
    path = "/v1/documents/bulk",
    tag = "Documents",
    operation_id = "createDocumentsBulk",
    request_body = DocumentBulkRequest,
    responses((status = 200, description = "A ZIP archive with one PDF per entry, in the order of the request.", content_type = "application/zip", body = Vec<u8>, headers(("Content-Disposition" = String, description = "`attachment; filename=\"…\"` with the suggested file name."))))
)]
pub(crate) async fn document_bulk(
    Extension(client): Extension<Client>,
    payload: Result<Json<DocumentBulkRequest>, JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(req) = payload.map_err(bad_json)?;
    let kind = parse_kind(&req.kind)?;
    check_bulk_size(&client, req.documents.len(), "documents")?;
    take_tokens(&client, req.documents.len()).await?;

    let mut errors = Errors::default();
    let settings = check_settings(&req.settings, &mut errors);
    if !errors.0.is_empty() {
        return Err(validation_error(errors));
    }
    let assets = settings_assets(&settings)?;
    let jobs: Vec<_> = req
        .documents
        .iter()
        .enumerate()
        .filter_map(|(i, doc)| {
            let path = format!("documents[{i}]");
            let settings_data = with_watermark(&client, settings.data.clone());
            prepare_document(kind, &req.settings, settings_data, assets.clone(), doc, &path, &mut errors)
        })
        .collect();
    if !errors.0.is_empty() {
        return Err(validation_error(errors));
    }

    let started = std::time::Instant::now();
    let pdfs = render_all(&client, kind.template(), "documents", jobs).await?;
    let names = req.documents.iter().map(|doc| documents::file_name(kind, doc)).collect();
    log_generated(&client, &format!("{}-bulk", kind.slug()), pdfs.len(), started, pdfs.iter().map(Vec::len).sum());
    crate::metrics::get().bulk_size.observe(pdfs.len() as f64);
    zip_response(&pdfs, names, kind.slug())
}

/// Create many invoices (ZIP of PDFs)
///
/// Renders many invoices with shared settings and returns a ZIP with one `invoice-<number>.pdf` per
/// invoice. If one invoice is invalid, nothing is returned and the error names the entry
/// (`invoices[3]: …`). The number of invoices per request depends on the plan (`bulkMax` of
/// `GET /v1/token`); `0` or more than `bulkMax` entries give `400 invalid_request`. Costs one
/// rate-limit unit per invoice, so the request also has to fit into `limitPerMinute`.
#[utoipa::path(
    post,
    path = "/v1/invoices/bulk",
    tag = "Invoices",
    operation_id = "createInvoicesBulk",
    request_body = InvoiceBulkRequest,
    responses((status = 200, description = "A ZIP archive with one PDF per entry, in the order of the request.", content_type = "application/zip", body = Vec<u8>, headers(("Content-Disposition" = String, description = "`attachment; filename=\"…\"` with the suggested file name."))))
)]
pub(crate) async fn bulk(
    Extension(client): Extension<Client>,
    payload: Result<Json<InvoiceBulkRequest>, JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(req) = payload.map_err(bad_json)?;
    check_bulk_size(&client, req.invoices.len(), "invoices")?;
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
    let assets = settings_assets(&settings)?;
    let jobs: Vec<_> = checked
        .into_iter()
        .zip(&req.invoices)
        .map(|(checked, invoice)| {
            invoice_data(&req.settings, with_watermark(&client, settings.data.clone()), invoice, checked, assets.clone())
        })
        .collect();

    let started = std::time::Instant::now();
    let pdfs = render_all(&client, INVOICE_TEMPLATE, "invoices", jobs).await?;
    let names = req.invoices.iter().map(|inv| format!("invoice-{}.pdf", file_stem(&inv.number))).collect();
    log_generated(&client, "bulk", pdfs.len(), started, pdfs.iter().map(Vec::len).sum());
    crate::metrics::get().bulk_size.observe(pdfs.len() as f64);
    zip_response(&pdfs, names, "invoices")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn render_all_keeps_order_and_names_the_failing_entry() {
        let client = Client { id: "t".into(), kind: store::Kind::Free, plan: "free".into(), limit: 10, created: None };
        const PAGE: &str = "#set document(date: datetime(year: 2026, month: 1, day: 1))\n#set page(width: 40mm, height: 20mm)\n{% if n == 1 %}#panic(\"boom\")\n{% endif %}Nr {{ n }}";
        let jobs = |ns: &[u32]| ns.iter().map(|n| (json!({ "n": n }), Vec::new())).collect::<Vec<_>>();

        let pdfs = render_all(&client, PAGE, "docs", jobs(&[0, 2, 3])).await.unwrap_or_else(|e| panic!("{}", e.details));
        assert_eq!(pdfs.len(), 3);
        assert!(pdfs.iter().all(|p| p.starts_with(b"%PDF")));

        let err = render_all(&client, PAGE, "docs", jobs(&[0, 1, 2])).await.err().expect("entry 1 fails");
        assert!(err.details.starts_with("docs[1]: "), "{}", err.details);

        let response = zip_response(&pdfs, vec!["a.pdf".into(); 3], "docs").unwrap_or_else(|e| panic!("{}", e.details));
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/zip");
        let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let archive = zip::ZipArchive::new(Cursor::new(body)).unwrap();
        let mut names: Vec<_> = archive.file_names().map(|n| n.unwrap().to_string()).collect();
        names.sort();
        assert_eq!(names, ["a-2.pdf", "a-3.pdf", "a.pdf"]);
    }

    #[test]
    fn zip_names_stay_unique() {
        let mut used = HashSet::new();
        let names: Vec<String> = ["a.pdf", "a.pdf", "a-2.pdf", "a.pdf"]
            .into_iter()
            .enumerate()
            .map(|(i, name)| unique_name(name.to_string(), i, &mut used))
            .collect();
        assert_eq!(used.len(), 4, "{names:?}");
    }

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
            for watermark in [false, true] {
            let mut sd = s.data.clone();
            if watermark {
                sd.as_object_mut().unwrap().insert("watermark".into(), "Entwurf".into());
            }
            let (data, assets) = documents::build(kind, &settings, sd, &raw, doc.clone(), Vec::new());
            let pdf = render_pdf(kind.template(), data, assets).await.unwrap_or_else(|e| panic!("{}: {}", kind.slug(), e.details));
            assert!(pdf.starts_with(b"%PDF"));
            let has_xml = pdf.windows(12).any(|w| w == b"factur-x.xml");
            assert_eq!(has_xml, kind == Kind::CreditNote, "{}", kind.slug());
            if let Ok(dir) = std::env::var("PDF_OUT") {
                std::fs::write(format!("{dir}/{}{}.pdf", kind.slug(), if watermark { "-wm" } else { "" }), pdf).unwrap();
            }
            }
        }
    }

    /// Timing benchmark: `cargo test --release bench_render -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn bench_render() {
        let settings: Settings = serde_json::from_value(json!({
            "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt", "email": "a@b.de", "vatId": "DE123456789"},
            "bank": {"iban": "DE89370400440532013000"},
        }))
        .unwrap();
        for count in [3usize, 60] {
            let items: Vec<_> = (0..count)
                .map(|i| json!({"description": format!("Position {i}"), "quantity": 2, "unit": "h", "price": 95, "taxRate": 19}))
                .collect();
            let raw: Invoice = serde_json::from_value(json!({
                "number": "2026-001", "date": "2026-01-31", "deliveryDate": "2026-01-30", "dueDate": "2026-02-14",
                "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
                "items": items,
            }))
            .unwrap();
            let mut errors = Errors::default();
            let s = check_settings(&settings, &mut errors);
            let invoice = check_invoice(&raw, "invoice", &mut errors);
            assert!(errors.0.is_empty(), "{:?}", errors.0);
            let mut times = Vec::new();
            for _ in 0..25 {
                let (data, assets) = invoice_data(&settings, s.data.clone(), &raw, invoice.clone(), Vec::new());
                let started = std::time::Instant::now();
                let pdf = render_pdf(INVOICE_TEMPLATE, data, assets).await.unwrap_or_else(|e| panic!("{}", e.details));
                times.push((started.elapsed().as_secs_f64() * 1000.0, pdf.len()));
            }
            times.remove(0);
            times.sort_by(|a, b| a.0.total_cmp(&b.0));
            println!("BENCH items={count} median={:.1}ms min={:.1}ms max={:.1}ms size={}", times[times.len() / 2].0, times[0].0, times[times.len() - 1].0, times[0].1);

            let client = Client { id: "bench".into(), kind: store::Kind::Paid, plan: "bench".into(), limit: 1000, created: None };
            let jobs = || (0..20).map(|_| invoice_data(&settings, s.data.clone(), &raw, invoice.clone(), Vec::new())).collect::<Vec<_>>();
            let started = std::time::Instant::now();
            for (data, assets) in jobs() {
                render_pdf(INVOICE_TEMPLATE, data, assets).await.unwrap_or_else(|e| panic!("{}", e.details));
            }
            let sequential = started.elapsed().as_secs_f64() * 1000.0;
            let started = std::time::Instant::now();
            render_all(&client, INVOICE_TEMPLATE, "invoices", jobs()).await.unwrap_or_else(|e| panic!("{}", e.details));
            println!("BENCH bulk 20 x items={count}: sequential={sequential:.0}ms parallel={:.0}ms", started.elapsed().as_secs_f64() * 1000.0);
        }
    }

    fn stamp() -> serde_json::Value {
        use base64::Engine as _;
        json!({"base64": base64::engine::general_purpose::STANDARD.encode(crate::postage::test_png(472, 283, None))})
    }

    /// PNG, SVG and PDF signatures are all printed on every document type and are not rejected.
    #[tokio::test]
    async fn renders_every_document_type_with_a_signature() {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><path d="M5 60 C 40 0, 70 90, 110 30 S 200 70, 290 20" stroke="#123" fill="none" stroke-width="3"/></svg>"##;
        let pdf_signature = render_pdf(
            "#set document(date: datetime(year: 2026, month: 1, day: 1))\n#set page(width: 60mm, height: 15mm, margin: 0pt)\n#curve(stroke: 1.5pt, curve.move((2mm, 10mm)), curve.cubic((15mm, 0mm), (30mm, 14mm), (58mm, 3mm)))",
            json!({}),
            Vec::new(),
        )
        .await
        .unwrap_or_else(|e| panic!("{}", e.details));
        let signatures = [
            ("png", crate::postage::test_png(300, 80, None)),
            ("svg", svg.as_bytes().to_vec()),
            ("pdf", pdf_signature),
        ];
        for (format, bytes) in signatures {
            for kind in Kind::ALL {
                let settings: Settings = serde_json::from_value(json!({
                    "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt"},
                    "signature": {"base64": B64.encode(&bytes)},
                }))
                .unwrap();
                let raw: Document = serde_json::from_value(json!({
                    "number": "2026-001", "date": "2026-01-31", "reference": "R-2026-007", "referenceDate": "2026-01-02",
                    "validUntil": "2026-02-28", "deliveryDate": "2026-02-03", "subject": "Betreff", "body": "Text",
                    "reason": "Falsche Menge", "closing": "Mit freundlichen Grüßen",
                    "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
                    "items": [{"description": "Beratung", "quantity": 8, "unit": "h", "price": 95, "taxRate": 19}],
                }))
                .unwrap();
                let mut errors = Errors::default();
                let s = check_settings(&settings, &mut errors);
                let doc = documents::check_document(kind, &raw, false, &mut errors);
                assert!(errors.0.is_empty(), "{format} {:?}", errors.0);
                let assets = settings_assets(&s).unwrap_or_else(|e| panic!("{}", e.details));
                assert!(assets.iter().any(|(name, _)| name == "signature"));
                let (data, assets) = documents::build(kind, &settings, s.data.clone(), &raw, doc, assets);
                let pdf = render_pdf(kind.template(), data, assets)
                    .await
                    .unwrap_or_else(|e| panic!("{format} {}: {}", kind.slug(), e.details));
                assert!(pdf.starts_with(b"%PDF"));
                if let Ok(dir) = std::env::var("PDF_OUT") {
                    std::fs::write(format!("{dir}/{}-signature-{format}.pdf", kind.slug()), pdf).unwrap();
                }
            }
        }
    }

    #[tokio::test]
    async fn renders_an_invoice_with_a_signature() {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        let png = crate::postage::test_png(300, 80, None);
        let settings: Settings = serde_json::from_value(json!({
            "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt"},
            "closing": "Danke!",
            "signature": {"base64": B64.encode(&png)},
        }))
        .unwrap();
        let invoice: Invoice = serde_json::from_value(json!({
            "number": "2026-001", "date": "2026-01-31",
            "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
            "items": [{"description": "Beratung", "quantity": 1, "unit": "h", "price": 95, "taxRate": 19}],
        }))
        .unwrap();
        let mut errors = Errors::default();
        let s = check_settings(&settings, &mut errors);
        let checked = check_invoice(&invoice, "invoice", &mut errors);
        assert!(errors.0.is_empty(), "{:?}", errors.0);
        let (data, assets) = invoice_data(&settings, s.data.clone(), &invoice, checked, settings_assets(&s).unwrap_or_else(|e| panic!("{}", e.details)));
        let pdf = render_pdf(INVOICE_TEMPLATE, data, assets).await.unwrap_or_else(|e| panic!("{}", e.details));
        assert!(pdf.starts_with(b"%PDF"));
        if let Ok(dir) = std::env::var("PDF_OUT") {
            std::fs::write(format!("{dir}/invoice-signature.pdf"), pdf).unwrap();
        }
    }

    #[test]
    fn rejects_signatures_that_are_not_images_or_pdfs() {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        for (bytes, ok) in [
            (b"hello world".to_vec(), false),
            (b"MZ\x90\x00 binary".to_vec(), false),
            (vec![b'a'; 301 * 1024], false),
            (b"<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"/>".to_vec(), true),
        ] {
            let settings: Settings = serde_json::from_value(json!({
                "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt"},
                "signature": {"base64": B64.encode(&bytes)},
            }))
            .unwrap();
            let mut errors = Errors::default();
            check_settings(&settings, &mut errors);
            assert_eq!(errors.0.is_empty(), ok, "{:?}", errors.0);
        }
        let settings: Settings = serde_json::from_value(json!({"signature": {"base64": "***"}})).unwrap();
        let mut errors = Errors::default();
        check_settings(&settings, &mut errors);
        assert!(errors.0.iter().any(|m| m.starts_with("settings.signature")));
    }

    #[tokio::test]
    async fn renders_every_document_type_with_a_stamp() {
        for kind in Kind::ALL {
            let settings: Settings = serde_json::from_value(json!({
                "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt", "email": "a@b.de", "vatId": "DE123456789"},
                "bank": {"iban": "DE89370400440532013000"},
            }))
            .unwrap();
            let raw: Document = serde_json::from_value(json!({
                "number": "2026-001", "date": "2026-01-31", "reference": "R-2026-007", "referenceDate": "2026-01-02",
                "validUntil": "2026-02-28", "deliveryDate": "2026-02-03", "subject": "Betreff",
                "body": "Zeile 1\nZeile 2", "reason": "Falsche Menge", "intro": "Hallo", "closing": "Gruß",
                "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
                "items": [{"description": "Beratung", "quantity": 8, "unit": "h", "price": 95, "taxRate": 19}],
                "postage": stamp(),
            }))
            .unwrap();
            let mut errors = Errors::default();
            let s = check_settings(&settings, &mut errors);
            let doc = documents::check_document(kind, &raw, false, &mut errors);
            assert!(errors.0.is_empty(), "{:?}", errors.0);
            assert_eq!(doc["postage"]["widthMm"], 40.0);
            let (data, assets) = documents::build(kind, &settings, s.data.clone(), &raw, doc, Vec::new());
            assert!(assets.iter().any(|(name, _)| name == "postage"), "{}", kind.slug());
            let pdf = render_pdf(kind.template(), data, assets).await.unwrap_or_else(|e| panic!("{}: {}", kind.slug(), e.details));
            assert!(pdf.starts_with(b"%PDF"));
            if let Ok(dir) = std::env::var("PDF_OUT") {
                std::fs::write(format!("{dir}/{}-stamp.pdf", kind.slug()), pdf).unwrap();
            }
        }
    }

    #[test]
    fn bulk_entries_carry_their_own_stamp() {
        let item = |n: &str, with_stamp: bool| {
            let mut v = json!({
                "number": n, "date": "2026-01-31",
                "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
                "items": [{"description": "Beratung", "quantity": 1, "unit": "h", "price": 95, "taxRate": 19}],
            });
            if with_stamp {
                v["postage"] = stamp();
            }
            v
        };
        let req: InvoiceBulkRequest = serde_json::from_value(json!({
            "settings": {"sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt"}},
            "invoices": [item("1", true), item("2", false)],
        }))
        .unwrap();
        let mut errors = Errors::default();
        let checked: Vec<_> = req.invoices.iter().enumerate().map(|(i, inv)| check_invoice(inv, &format!("invoices[{i}]"), &mut errors)).collect();
        assert!(errors.0.is_empty(), "{:?}", errors.0);
        assert_eq!(checked[0]["postage"]["widthMm"], 40.0);
        assert!(checked[1].get("postage").is_none());

        let docs: DocumentBulkRequest = serde_json::from_value(json!({
            "settings": {"sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt"}},
            "type": "letter", "documents": [{"number": "1", "date": "2026-01-31", "recipient": {"name": "K", "address": "W 1", "city": "5 S"}, "postage": stamp()}],
        }))
        .unwrap();
        assert!(docs.documents[0].postage.is_some());
    }

    #[tokio::test]
    async fn renders_invoice_with_a_stamp() {
        let settings: Settings = serde_json::from_value(json!({
            "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt", "email": "a@b.de", "vatId": "DE123456789"},
            "bank": {"iban": "DE89370400440532013000"},
        }))
        .unwrap();
        let raw: Invoice = serde_json::from_value(json!({
            "number": "2026-001", "date": "2026-01-31", "deliveryDate": "2026-01-30", "dueDate": "2026-02-14",
            "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
            "items": [{"description": "Beratung", "quantity": 8, "unit": "h", "price": 95, "taxRate": 19}],
            "postage": stamp(),
        }))
        .unwrap();
        let mut errors = Errors::default();
        let s = check_settings(&settings, &mut errors);
        let invoice = check_invoice(&raw, "invoice", &mut errors);
        assert!(errors.0.is_empty(), "{:?}", errors.0);
        let (data, assets) = invoice_data(&settings, s.data, &raw, invoice, Vec::new());
        let pdf = render_pdf(INVOICE_TEMPLATE, data, assets).await.unwrap_or_else(|e| panic!("{}", e.details));
        assert!(pdf.starts_with(b"%PDF"));
        if let Ok(dir) = std::env::var("PDF_OUT") {
            std::fs::write(format!("{dir}/invoice-stamp.pdf"), pdf).unwrap();
        }
    }

    /// Fixed e-invoice corpus for the Mustang conformance check in CI (`docs/epics/E01-einvoice-conformance-ci.md`).
    /// With `PDF_OUT=<dir>` the PDFs are written as `<dir>/einvoice-<name>.pdf`; without it the test still checks
    /// that every document carries a complete e-invoice XML (no `invoice-draft.xml`).
    #[tokio::test]
    async fn renders_einvoice_conformance_corpus() {
        let sender = json!({
            "name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt",
            "email": "rechnung@muster.example", "phone": "+49 30 123456", "contactName": "Erika Muster",
            "vatId": "DE123456789", "taxNr": "12/345/67890",
        });
        let bank = json!({"name": "Musterbank", "iban": "DE89370400440532013000", "bic": "COBADEFFXXX"});
        let recipient = json!({
            "name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt",
            "vatId": "DE987654321", "email": "einkauf@kunde.example", "buyerReference": "04011000-12345-34",
        });
        let mixed_items = json!([
            {"description": "Beratung", "quantity": 8, "unit": "h", "price": 95, "taxRate": 19},
            {"description": "Fachbuch", "quantity": 3, "unit": "pcs", "price": 24.9, "taxRate": 7},
            {"description": "Wartungspauschale", "quantity": 1, "unit": "flat", "price": 149.99, "taxRate": 19},
        ]);
        let exempt_items = json!([
            {"description": "Beratung", "quantity": 2.5, "unit": "h", "price": 80, "taxRate": 19},
            {"description": "Innergemeinschaftliche Lieferung", "quantity": 12, "unit": "kg", "price": 3.333, "taxRate": 0},
        ]);
        let settings = |profile: &str, locale: &str| json!({
            "sender": sender, "bank": bank, "locale": locale, "einvoiceProfile": profile, "paymentDays": 30,
            "exemptionReason": "Steuerfrei nach § 4 Nr. 1b UStG",
        });
        let invoice = |items: &serde_json::Value| json!({
            "number": "2026-001", "date": "2026-01-31", "recipient": recipient, "items": items,
        });
        let credit_note = |items: &serde_json::Value| json!({
            "number": "G-2026-001", "date": "2026-02-10", "reference": "2026-001", "referenceDate": "2026-01-31",
            "reason": "Falsche Menge", "recipient": recipient, "items": items,
        });

        // (file name, e-invoice file expected in the PDF, settings, credit note?, document)
        let corpus = [
            ("en16931-mixed-rates", "factur-x.xml", settings("en16931", "de-de"), false, invoice(&mixed_items)),
            ("en16931-exempt", "factur-x.xml", settings("en16931", "de-de"), false, invoice(&exempt_items)),
            ("en16931-english", "factur-x.xml", settings("en16931", "en-de"), false, invoice(&mixed_items)),
            ("xrechnung-mixed-rates", "xrechnung.xml", settings("xrechnung", "de-de"), false, invoice(&mixed_items)),
            ("xrechnung-exempt", "xrechnung.xml", settings("xrechnung", "de-de"), false, invoice(&exempt_items)),
            ("credit-note-en16931", "factur-x.xml", settings("en16931", "de-de"), true, credit_note(&mixed_items)),
            ("credit-note-xrechnung", "xrechnung.xml", settings("xrechnung", "de-de"), true, credit_note(&exempt_items)),
        ];
        for (name, attached, settings, is_credit_note, document) in corpus {
            let settings: Settings = serde_json::from_value(settings).unwrap();
            let mut errors = Errors::default();
            let s = check_settings(&settings, &mut errors);
            let pdf = if is_credit_note {
                let raw: Document = serde_json::from_value(document).unwrap();
                let doc = documents::check_document(Kind::CreditNote, &raw, settings.locale.as_deref() == Some("en-de"), &mut errors);
                assert!(errors.0.is_empty(), "{name}: {:?}", errors.0);
                let (data, assets) = documents::build(Kind::CreditNote, &settings, s.data, &raw, doc, Vec::new());
                render_pdf(Kind::CreditNote.template(), data, assets).await
            } else {
                let raw: Invoice = serde_json::from_value(document).unwrap();
                let invoice = check_invoice(&raw, "invoice", &mut errors);
                assert!(errors.0.is_empty(), "{name}: {:?}", errors.0);
                let (data, assets) = invoice_data(&settings, s.data, &raw, invoice, Vec::new());
                render_pdf(INVOICE_TEMPLATE, data, assets).await
            }
            .unwrap_or_else(|e| panic!("{name}: {}", e.details));
            assert!(pdf.starts_with(b"%PDF"), "{name}");
            let contains = |needle: &[u8]| pdf.windows(needle.len()).any(|w| w == needle);
            assert!(contains(attached.as_bytes()), "{name}: {attached} is not attached");
            assert!(!contains(b"invoice-draft.xml"), "{name}: the e-invoice XML is only a draft");
            if let Ok(dir) = std::env::var("PDF_OUT") {
                std::fs::write(format!("{dir}/einvoice-{name}.pdf"), pdf).unwrap();
            }
        }
    }

    #[tokio::test]
    async fn renders_invoice_with_and_without_watermark() {
        let settings: Settings = serde_json::from_value(json!({
            "sender": {"name": "Muster GmbH", "address": "Musterstr. 1", "city": "12345 Musterstadt", "email": "a@b.de", "vatId": "DE123456789"},
            "bank": {"iban": "DE89370400440532013000"},
        }))
        .unwrap();
        let raw: Invoice = serde_json::from_value(json!({
            "number": "2026-001", "date": "2026-01-31", "deliveryDate": "2026-01-30", "dueDate": "2026-02-14",
            "recipient": {"name": "Kunde AG", "address": "Kundenweg 5", "city": "54321 Kundenstadt"},
            "items": [{"description": "Beratung", "quantity": 8, "unit": "h", "price": 95, "taxRate": 19}],
        }))
        .unwrap();
        for watermark in [false, true] {
            let mut errors = Errors::default();
            let s = check_settings(&settings, &mut errors);
            let invoice = check_invoice(&raw, "invoice", &mut errors);
            assert!(errors.0.is_empty(), "{:?}", errors.0);
            let mut sd = s.data;
            if watermark {
                sd.as_object_mut().unwrap().insert("watermark".into(), "Entwurf".into());
            }
            let (data, assets) = invoice_data(&settings, sd, &raw, invoice, Vec::new());
            let pdf = render_pdf(INVOICE_TEMPLATE, data, assets).await.unwrap_or_else(|e| panic!("{}", e.details));
            assert!(pdf.starts_with(b"%PDF"));
            if let Ok(dir) = std::env::var("PDF_OUT") {
                std::fs::write(format!("{dir}/invoice{}.pdf", if watermark { "-wm" } else { "" }), pdf).unwrap();
            }
        }
    }

    // ------------------------------------------------------------ OpenAPI spec (docs/openapi.yaml)

    fn spec() -> serde_json::Value {
        crate::openapi::spec()
    }

    /// All request examples of an operation: `(name, body)`.
    fn spec_examples(spec: &serde_json::Value, path: &str) -> Vec<(String, serde_json::Value)> {
        let examples = &spec["paths"][path]["post"]["requestBody"]["content"]["application/json"]["examples"];
        let examples = examples.as_object().unwrap_or_else(|| panic!("{path} has request examples"));
        assert!(!examples.is_empty(), "{path} has request examples");
        examples.iter().map(|(name, example)| (format!("{path} {name}"), example["value"].clone())).collect()
    }

    fn enum_values(schema: &serde_json::Value) -> Vec<String> {
        schema["enum"]
            .as_array()
            .expect("an enum")
            .iter()
            .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_string))
            .collect()
    }

    /// Validates an invoice request the way the handlers do and renders it.
    async fn render_invoice_example(name: &str, settings: serde_json::Value, invoice: serde_json::Value) {
        let settings: Settings = serde_json::from_value(settings).unwrap_or_else(|e| panic!("{name}: {e}"));
        let invoice: Invoice = serde_json::from_value(invoice).unwrap_or_else(|e| panic!("{name}: {e}"));
        let mut errors = Errors::default();
        let checked_settings = check_settings(&settings, &mut errors);
        let checked = check_invoice(&invoice, "invoice", &mut errors);
        assert!(errors.0.is_empty(), "{name}: {:?}", errors.0);
        let (data, assets) = invoice_data(&settings, checked_settings.data, &invoice, checked, Vec::new());
        let pdf = render_pdf(INVOICE_TEMPLATE, data, assets).await.unwrap_or_else(|e| panic!("{name}: {}", e.details));
        assert!(pdf.starts_with(b"%PDF"), "{name}");
    }

    /// Validates a document request the way the handlers do and renders it.
    async fn render_document_example(name: &str, kind: &str, settings: serde_json::Value, document: serde_json::Value) {
        let kind = Kind::parse(kind).unwrap_or_else(|| panic!("{name}: unknown type {kind}"));
        let settings: Settings = serde_json::from_value(settings).unwrap_or_else(|e| panic!("{name}: {e}"));
        let document: Document = serde_json::from_value(document).unwrap_or_else(|e| panic!("{name}: {e}"));
        let mut errors = Errors::default();
        let checked_settings = check_settings(&settings, &mut errors);
        assert!(errors.0.is_empty(), "{name}: {:?}", errors.0);
        let (data, assets) = prepare_document(kind, &settings, checked_settings.data, Vec::new(), &document, "document", &mut errors)
            .unwrap_or_else(|| panic!("{name}: {:?}", errors.0));
        let pdf = render_pdf(kind.template(), data, assets).await.unwrap_or_else(|e| panic!("{name}: {}", e.details));
        assert!(pdf.starts_with(b"%PDF"), "{name}");
    }

    /// The request examples of `docs/openapi.yaml` are real requests: every one passes the validation
    /// of the handlers and renders a PDF, so the spec cannot drift from the code unnoticed.
    #[tokio::test]
    async fn openapi_request_examples_are_accepted() {
        let spec = spec();

        for (name, body) in spec_examples(&spec, "/v1/invoices") {
            render_invoice_example(&name, body["settings"].clone(), body["invoice"].clone()).await;
        }
        for (name, body) in spec_examples(&spec, "/v1/invoices/bulk") {
            let invoices = body["invoices"].as_array().expect("invoices");
            assert!(!invoices.is_empty(), "{name}");
            for (i, invoice) in invoices.iter().enumerate() {
                render_invoice_example(&format!("{name}[{i}]"), body["settings"].clone(), invoice.clone()).await;
            }
        }

        let mut single_types = Vec::new();
        for (name, body) in spec_examples(&spec, "/v1/documents") {
            let kind = body["type"].as_str().expect("type").to_string();
            render_document_example(&name, &kind, body["settings"].clone(), body["document"].clone()).await;
            single_types.push(kind);
        }
        for kind in Kind::ALL {
            assert!(single_types.contains(&kind.slug().to_string()), "/v1/documents has no example for {}", kind.slug());
        }
        for (name, body) in spec_examples(&spec, "/v1/documents/bulk") {
            let kind = body["type"].as_str().expect("type").to_string();
            let documents = body["documents"].as_array().expect("documents");
            assert!(!documents.is_empty(), "{name}");
            for (i, document) in documents.iter().enumerate() {
                render_document_example(&format!("{name}[{i}]"), &kind, body["settings"].clone(), document.clone()).await;
            }
        }
    }

    /// The limits written into the `#[schema(...)]` attributes are the ones the validation enforces
    /// (attributes only take literals, so they cannot use the constants directly).
    #[test]
    fn openapi_limits_match_the_validation() {
        let spec = spec();
        let schemas = &spec["components"]["schemas"];

        assert_eq!(schemas["Invoice"]["properties"]["items"]["maxItems"], crate::invoice::MAX_ITEMS);
        assert_eq!(schemas["Document"]["properties"]["items"]["maxItems"], crate::invoice::MAX_ITEMS);
        for (schema, property) in [
            ("Sender", "name"),
            ("Recipient", "name"),
            ("Bank", "iban"),
            ("Invoice", "number"),
            ("Document", "subject"),
        ] {
            assert_eq!(schemas[schema]["properties"][property]["maxLength"], crate::invoice::MAX_SHORT, "{schema}.{property}");
        }
        for (schema, property) in [("Settings", "footer"), ("Settings", "closing"), ("Item", "description"), ("Document", "reason")] {
            assert_eq!(schemas[schema]["properties"][property]["maxLength"], crate::invoice::MAX_LONG, "{schema}.{property}");
        }
        let kinds: Vec<&str> = Kind::ALL.iter().map(|k| k.slug()).collect();
        assert_eq!(enum_values(&schemas["DocumentType"]), kinds);
    }

    /// Every error code the handlers answer with is documented in the `Error` schema.
    #[test]
    fn openapi_lists_every_error_code() {
        let spec = spec();
        let documented = enum_values(&spec["components"]["schemas"]["Error"]["properties"]["error"]);
        let mut used = std::collections::BTreeSet::new();
        for source in [include_str!("main.rs"), include_str!("v1.rs")] {
            // `ApiError::new(StatusCode::X, "code", ...)`, possibly spread over several lines.
            let production_code = source.split("#[cfg(test)]").next().unwrap_or(source);
            for call in production_code.split("ApiError::new(").skip(1) {
                if let Some(code) = call.split('"').nth(1) {
                    used.insert(code.to_string());
                }
            }
        }
        assert!(!used.is_empty());
        for code in used {
            assert!(documented.contains(&code), "error code {code} is missing in openapi_overlay.yaml (errorCodes)");
        }
    }
}
