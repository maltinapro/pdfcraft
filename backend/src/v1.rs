//! `/v1` API: fixed server-side template, token authentication (free or paid), per-token
//! rate limit. The client sends plain invoice data; the template never leaves the server.

use crate::config;
use crate::documents::{self, Document, Kind};
use crate::einvoice;
use crate::invoice::{check_invoice, check_settings, file_stem, Errors, Invoice, Settings};
use crate::store::{self, Client};
use crate::{decode_assets, render_pdf, render_pdf_with_zones, ApiError, ZoneRect};
use axum::{
    extract::{rejection::JsonRejection, DefaultBodyLimit, Extension, Json, Query, Request},
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
use utoipa::ToSchema;

mod warm_up;
pub use warm_up::warm_up;

/// The same template the frontend ships (shared layout plus the invoice body); compiled into the binary.
pub(crate) const INVOICE_TEMPLATE: &str = concat!(
    include_str!("../../frontend/src/template/layout.typ"),
    "\n",
    include_str!("../../frontend/src/template/invoice.typ")
);

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
        .route(
            "/postage/products",
            get(crate::internetmarke::list_products),
        )
        .route("/postage/stamps", post(crate::internetmarke::buy_stamp))
        .route(
            "/postage/stamps/bulk",
            post(crate::internetmarke::buy_stamps_bulk),
        )
        .route(
            "/postage/stamps/recover",
            post(crate::internetmarke::recover_stamps),
        )
        .route("/token", get(crate::mollie::token_info))
        .route(
            "/subscription/cancel",
            post(crate::mollie::cancel_subscription),
        )
        .layer(middleware::from_fn(auth));
    // Free tokens are issued against an Anubis pass instead of a token
    // Purchases (Mollie): only answer while `Config::mollie_enabled`
    Router::new()
        .route("/version", get(crate::version::info))
        .route("/free-token", post(crate::free::issue))
        .route(
            "/client-errors",
            post(crate::client_errors::report).layer(DefaultBodyLimit::max(1024)),
        )
        .route("/checkout", post(crate::mollie::checkout))
        .route("/checkout/offers", get(crate::mollie::offers))
        .route("/mollie/webhook", post(crate::mollie::webhook))
        .route("/tokens/claim", get(crate::mollie::claim))
        .merge(protected)
}

fn presented_key(req: &Request) -> Option<String> {
    let headers = req.headers();
    if let Some(value) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    {
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
    let presented = presented_key(&req).unwrap_or_default();
    let service = crate::service_tokens::lookup(&presented);
    // Without Valkey only static service tokens can be checked; that is a valid setup when
    // `VALKEY_URL` is not set at all (a Valkey that is still connecting answers 503).
    let service_only =
        config::get().valkey_url.is_none() && !config::get().service_tokens.is_empty();
    if service.is_none() && !store::is_configured() && !service_only {
        return store_unavailable().into_response();
    }
    let found = match service {
        Some(client) => Ok(Some(client)),
        None if !store::is_configured() => Ok(None),
        None => store::lookup(&presented).await,
    };
    match found {
        Err(_) => {
            crate::metrics::auth_failure("store_unavailable");
            store_unavailable().into_response()
        }
        Ok(None) => {
            crate::metrics::auth_failure("invalid_token");
            tracing::warn!(event = "auth_failed", reason = "invalid_token");
            unauthorized(
                "missing, invalid or expired token (use `Authorization: ****** or `X-API-Key`)",
            )
        }
        Ok(Some(client))
            if client.kind == store::Kind::Paid && !config::get().paid_tokens_enabled =>
        {
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
            format!(
                "{cost} invoices exceed the limit of {} per minute",
                client.limit
            ),
        ));
    }
    // Service tokens keep an in-process bucket when there is no Valkey at all
    let taken = if client.kind == store::Kind::Service && config::get().valkey_url.is_none() {
        Ok(crate::service_tokens::take(client, cost as u32))
    } else {
        store::take(client, cost as u32).await
    };
    match taken {
        Ok(Ok(())) => Ok(()),
        Ok(Err(wait)) => {
            crate::metrics::rate_limited(client);
            tracing::warn!(event = "rate_limited", token_id = %client.id, token_kind = client.kind.label(), token_plan = %client.plan, wait_secs = wait);
            Err(limited(client.limit, Some(wait)))
        }
        Err(_) => Err(store_unavailable()),
    }
}

/// Optional per-request render options.
#[derive(Deserialize, Default, ToSchema)]
pub(crate) struct Options {
    /// `draft` prints the diagonal "Entwurf" / "Draft" watermark (by document language) on every PDF of the
    /// request, for any token. Free tokens always get the watermark, with or without this option.
    watermark: Option<WatermarkOption>,
}

/// Value of `options.watermark`.
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "lowercase")]
pub(crate) enum WatermarkOption {
    Draft,
}

/// PDFs created with a free token, or with `options.watermark = "draft"`, get a diagonal
/// "Entwurf" / "Draft" watermark (by document language).
fn with_watermark(
    client: &Client,
    options: &Options,
    mut settings: serde_json::Value,
) -> serde_json::Value {
    if client.kind == store::Kind::Free || options.watermark == Some(WatermarkOption::Draft) {
        if let Some(obj) = settings.as_object_mut() {
            let english = obj.get("locale").and_then(|v| v.as_str()) == Some("en-de");
            obj.insert(
                "watermark".into(),
                if english { "Draft" } else { "Entwurf" }.into(),
            );
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
    ApiError::new(
        StatusCode::BAD_REQUEST,
        "validation_error",
        shown.join("; "),
    )
}

#[derive(Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct PreviewQuery {
    /// Include PDF zone geometry in `X-Pdfcraft-Zones`; only `1` enables it.
    zones: Option<String>,
}

impl PreviewQuery {
    fn includes_zones(&self) -> bool {
        self.zones.as_deref() == Some("1")
    }
}

fn bad_json(e: JsonRejection) -> ApiError {
    ApiError::new(e.status(), "invalid_request", e.body_text())
}

/// One invoice with its settings.
#[derive(Deserialize, ToSchema)]
pub(crate) struct InvoiceRequest {
    settings: Settings,
    invoice: Invoice,
    #[serde(default)]
    options: Options,
}

/// Many invoices with shared settings.
#[derive(Deserialize, ToSchema)]
pub(crate) struct InvoiceBulkRequest {
    settings: Settings,
    /// Between 1 and `bulkMax` of the token (see `GET /v1/token`).
    #[schema(min_items = 1)]
    invoices: Vec<Invoice>,
    #[serde(default)]
    options: Options,
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
    params(PreviewQuery),
    responses((status = 200, description = "The PDF (PDF/A-3b).", content_type = "application/pdf", body = Vec<u8>, headers(("Content-Disposition" = String, description = "`attachment; filename=\"…\"` with the suggested file name."), ("X-Pdfcraft-Zones" = String, description = "Optional JSON array of zone rectangles in millimeters, present only for `?zones=1`."))))
)]
pub(crate) async fn single(
    Extension(client): Extension<Client>,
    Query(preview): Query<PreviewQuery>,
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
    let (data, assets) = invoice_data(
        &req.settings,
        with_watermark(&client, &req.options, settings.data),
        &req.invoice,
        invoice,
        assets,
    );
    let started = std::time::Instant::now();
    let (pdf, zones) = if preview.includes_zones() {
        render_pdf_with_zones(INVOICE_TEMPLATE, data, assets).await?
    } else {
        (
            render_pdf(INVOICE_TEMPLATE, data, assets).await?,
            Vec::new(),
        )
    };
    crate::metrics::observe_pdf(&client, started.elapsed().as_secs_f64(), pdf.len());
    log_generated(&client, "single", 1, started, pdf.len());
    Ok(pdf_response(
        pdf,
        &format!("invoice-{}.pdf", file_stem(&req.invoice.number)),
        preview.includes_zones().then_some(&zones),
    ))
}

/// One document of the given type with its settings.
#[derive(Deserialize, ToSchema)]
pub(crate) struct DocumentRequest {
    #[serde(rename = "type")]
    #[schema(value_type = Kind, required = true)]
    kind: String,
    settings: Settings,
    document: Document,
    #[serde(default)]
    options: Options,
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

fn log_generated(
    client: &Client,
    endpoint: &str,
    count: usize,
    started: std::time::Instant,
    size: usize,
) {
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

fn pdf_response(pdf: Vec<u8>, file_name: &str, zones: Option<&[ZoneRect]>) -> Response {
    let mut response = (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/pdf".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{file_name}\""),
            ),
        ],
        pdf,
    )
        .into_response();
    if let Some(zones) = zones {
        if let Ok(json) = serde_json::to_string(zones) {
            if let Ok(value) = json.parse() {
                response.headers_mut().insert("x-pdfcraft-zones", value);
            }
        }
    }
    response
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
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let mut used = HashSet::new();
    for (i, (pdf, name)) in pdfs.iter().zip(names).enumerate() {
        zip.start_file(unique_name(name, i, &mut used), options)
            .map_err(|e| zip_err(e.to_string()))?;
        zip.write_all(pdf).map_err(|e| zip_err(e.to_string()))?;
    }
    let bytes = zip
        .finish()
        .map_err(|e| zip_err(e.to_string()))?
        .into_inner();
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{archive}.zip\""),
            ),
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
        let (i, result, seconds) = joined.map_err(|e| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "task_join_error",
                e.to_string(),
            )
        })?;
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
    params(PreviewQuery),
    request_body = DocumentRequest,
    responses((status = 200, description = "The PDF (PDF/A-3b).", content_type = "application/pdf", body = Vec<u8>, headers(("Content-Disposition" = String, description = "`attachment; filename=\"…\"` with the suggested file name."), ("X-Pdfcraft-Zones" = String, description = "Optional JSON array of zone rectangles in millimeters, present only for `?zones=1`."))))
)]
pub(crate) async fn document_single(
    Extension(client): Extension<Client>,
    Query(preview): Query<PreviewQuery>,
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
        with_watermark(&client, &req.options, settings.data),
        assets,
        &req.document,
        "document",
        &mut errors,
    ) else {
        return Err(validation_error(errors));
    };
    let started = std::time::Instant::now();
    let (pdf, zones) = if preview.includes_zones() {
        render_pdf_with_zones(kind.template(), data, assets).await?
    } else {
        (render_pdf(kind.template(), data, assets).await?, Vec::new())
    };
    crate::metrics::observe_pdf(&client, started.elapsed().as_secs_f64(), pdf.len());
    log_generated(&client, kind.slug(), 1, started, pdf.len());
    Ok(pdf_response(
        pdf,
        &documents::file_name(kind, &req.document),
        preview.includes_zones().then_some(&zones),
    ))
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
    #[serde(default)]
    options: Options,
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
            let settings_data = with_watermark(&client, &req.options, settings.data.clone());
            prepare_document(
                kind,
                &req.settings,
                settings_data,
                assets.clone(),
                doc,
                &path,
                &mut errors,
            )
        })
        .collect();
    if !errors.0.is_empty() {
        return Err(validation_error(errors));
    }

    let started = std::time::Instant::now();
    let pdfs = render_all(&client, kind.template(), "documents", jobs).await?;
    let names = req
        .documents
        .iter()
        .map(|doc| documents::file_name(kind, doc))
        .collect();
    log_generated(
        &client,
        &format!("{}-bulk", kind.slug()),
        pdfs.len(),
        started,
        pdfs.iter().map(Vec::len).sum(),
    );
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
            invoice_data(
                &req.settings,
                with_watermark(&client, &req.options, settings.data.clone()),
                invoice,
                checked,
                assets.clone(),
            )
        })
        .collect();

    let started = std::time::Instant::now();
    let pdfs = render_all(&client, INVOICE_TEMPLATE, "invoices", jobs).await?;
    let names = req
        .invoices
        .iter()
        .map(|inv| format!("invoice-{}.pdf", file_stem(&inv.number)))
        .collect();
    log_generated(
        &client,
        "bulk",
        pdfs.len(),
        started,
        pdfs.iter().map(Vec::len).sum(),
    );
    crate::metrics::get().bulk_size.observe(pdfs.len() as f64);
    zip_response(&pdfs, names, "invoices")
}
#[cfg(test)]
mod tests;
