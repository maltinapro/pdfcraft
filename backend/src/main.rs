mod config;
mod facturx;
mod invoice;
mod store;
mod v1;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use axum::{
    extract::{
        rejection::JsonRejection,
        DefaultBodyLimit,
        Json,
    },
    http::{
        header,
        StatusCode,
    },
    response::{
        IntoResponse,
        Response,
    },
    routing::{
        get,
        post,
    },
    Router,
};
use minijinja::{Environment, Value};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::{
    borrow::Cow,
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
};
use typst::{
    diag::{FileError, FileResult},
    foundations::Bytes,
    syntax::{FileId, Source},
};
use typst_as_lib::{
    conversions::IntoFileId,
    file_resolver::{FileResolver, FileSystemResolver},
    cached_file_resolver::IntoCachedFileResolver,
    typst_kit_options::TypstKitFontOptions, TypstEngine, TypstTemplateCollection,
};

const MAX_REQUEST_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_ASSETS: usize = 8;
const MAX_ASSET_BYTES: usize = 1024 * 1024;

type Sources = Arc<Mutex<HashMap<FileId, Source>>>;
type Assets = Arc<Mutex<HashMap<FileId, Bytes>>>;

struct RequestSources {
    sources: Sources,
    assets: Assets,
}

impl FileResolver for RequestSources {
    fn resolve_binary(&self, id: FileId) -> FileResult<Cow<'_, Bytes>> {
        match self.assets.lock().unwrap().get(&id) {
            Some(bytes) => Ok(Cow::Owned(bytes.clone())),
            None => Err(FileError::NotFound(id.vpath().get_without_slash().into())),
        }
    }

    fn resolve_source(&self, id: FileId) -> FileResult<Cow<'_, Source>> {
        match self.sources.lock().unwrap().get(&id) {
            Some(src) => Ok(Cow::Owned(src.clone())),
            None => Err(FileError::NotFound(id.vpath().get_without_slash().into())),
        }
    }
}

struct Compiler {
    engine: TypstEngine<TypstTemplateCollection>,
    sources: Sources,
    assets: Assets,
}

static COMPILER: OnceLock<Compiler> = OnceLock::new();
static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(0);

fn compiler() -> &'static Compiler {
    COMPILER.get_or_init(|| {
        let sources: Sources = Arc::default();
        let assets: Assets = Arc::default();
        // Packages are vendored; no network access at runtime.
        let package_root = std::env::var_os("TYPST_PACKAGE_PATH")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("vendor/typst-packages")
            });
        let engine = TypstEngine::builder()
            .search_fonts_with(TypstKitFontOptions::default())
            .add_file_resolver(RequestSources {
                sources: sources.clone(),
                assets: assets.clone(),
            })
            .add_file_resolver(FileSystemResolver::new(package_root.clone()).local_package_root(package_root).into_cached())
            .comemo_evict_max_age(Some(10))
            .build();
        Compiler {
            engine,
            sources,
            assets,
        }
    })
}

// PDF/A-3b is required to embed the ZUGFeRD/Factur-X XML (invoice-pro `zugferd:`).
fn pdf_options() -> typst_pdf::PdfOptions {
    typst_pdf::PdfOptions {
        standards: typst_pdf::PdfStandards::new(&[typst_pdf::PdfStandard::A_3b])
            .expect("valid PDF standard"),
        ..Default::default()
    }
}

fn asset_path(request_id: u64, key: &str) -> String {
    format!("/req-{request_id}-{key}")
}

fn compile_pdf(
    rendered: String,
    request_id: u64,
    assets: Vec<(String, Vec<u8>)>,
) -> Result<Vec<u8>, String> {
    let started = std::time::Instant::now();
    let c = compiler();
    let name = format!("/req-{request_id}.typ");
    let id = name.as_str().into_file_id();
    let asset_ids: Vec<FileId> = assets
        .into_iter()
        .map(|(key, bytes)| {
            let asset_id = asset_path(request_id, &key).as_str().into_file_id();
            c.assets.lock().unwrap().insert(asset_id, Bytes::new(bytes));
            asset_id
        })
        .collect();
    c.sources
        .lock()
        .unwrap()
        .insert(id, Source::new(id, rendered));

    let result = c.engine.with_world(id, |world| {
        let doc = typst::compile(world)
            .output
            .map_err(|e| format!("Typst compilation error: {e:?}"))?;
        let compiled = started.elapsed();
        let pdf = typst_pdf::pdf(&doc, &pdf_options())
            .map_err(|e| format!("Typst PDF generation error: {e:?}"))?;
        let pdf = facturx::add_facturx_xmp(pdf);
        println!(
            "typst layout: {compiled:?}, pdf export: {:?}",
            started.elapsed() - compiled
        );
        Ok(pdf)
    });

    c.sources.lock().unwrap().remove(&id);
    for asset_id in asset_ids {
        c.assets.lock().unwrap().remove(&asset_id);
    }
    println!("typst compile+pdf: {:?}", started.elapsed());
    match result {
        Ok(r) => r,
        Err(e) => Err(format!("Typst world setup error: {e}")),
    }
}

#[derive(Deserialize)]
struct GenerateRequest {
    template: String,
    data: JsonValue,
    /// Binary files (e.g. a logo) as base64, exposed to the template as
    /// `assets.<key>` (an absolute virtual path usable in `image(...)`).
    #[serde(default)]
    assets: HashMap<String, String>,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: &'static str,
    details: String,
}

pub(crate) struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub details: String,
    pub retry_after: Option<u64>,
}

impl ApiError {
    pub fn new(status: StatusCode, code: &'static str, details: impl Into<String>) -> Self {
        Self {
            status,
            code,
            details: details.into(),
            retry_after: None,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut response = (
            self.status,
            Json(ErrorResponse {
                error: self.code,
                details: self.details,
            }),
        )
            .into_response();
        if let Some(secs) = self.retry_after {
            response.headers_mut().insert(header::RETRY_AFTER, secs.into());
        }
        response
    }
}

/// Decodes base64 assets (e.g. a logo) after checking count, key and size limits.
pub(crate) fn decode_assets(
    assets: &HashMap<String, String>,
) -> Result<Vec<(String, Vec<u8>)>, ApiError> {
    let bad = |details: String| ApiError::new(StatusCode::BAD_REQUEST, "invalid_asset", details);
    if assets.len() > MAX_ASSETS {
        return Err(bad(format!("at most {MAX_ASSETS} assets are allowed")));
    }
    let mut decoded = Vec::new();
    for (key, encoded) in assets {
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(bad(format!("asset key `{key}` must be alphanumeric")));
        }
        match BASE64.decode(encoded) {
            Ok(bytes) if bytes.len() <= MAX_ASSET_BYTES => decoded.push((key.clone(), bytes)),
            Ok(_) => return Err(bad(format!("asset `{key}` exceeds {MAX_ASSET_BYTES} bytes"))),
            Err(e) => return Err(bad(format!("asset `{key}` is not valid base64: {e}"))),
        }
    }
    Ok(decoded)
}

static COMPILE_SLOTS: OnceLock<tokio::sync::Semaphore> = OnceLock::new();

fn compile_slots() -> &'static tokio::sync::Semaphore {
    COMPILE_SLOTS.get_or_init(|| tokio::sync::Semaphore::new(config::get().max_concurrent_compiles))
}

/// Renders the minijinja template and compiles it to a PDF. At most
/// `MAX_CONCURRENT_COMPILES` compilations run at the same time.
pub(crate) async fn render_pdf(
    template: &str,
    mut data: JsonValue,
    assets: Vec<(String, Vec<u8>)>,
) -> Result<Vec<u8>, ApiError> {
    let request_id = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);

    if !assets.is_empty() {
        let paths: serde_json::Map<String, JsonValue> = assets
            .iter()
            .map(|(key, _)| (key.clone(), JsonValue::String(asset_path(request_id, key))))
            .collect();
        match data.as_object_mut() {
            Some(obj) => {
                obj.insert("assets".into(), JsonValue::Object(paths));
            }
            None => {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "invalid_request",
                    "`data` must be an object when assets are used",
                ));
            }
        }
    }

    let mut env = Environment::new();
    env.add_template("doc", template).map_err(|e| {
        ApiError::new(StatusCode::BAD_REQUEST, "template_parse_error", e.to_string())
    })?;
    let tmpl = env.get_template("doc").map_err(|e| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "template_load_error",
            e.to_string(),
        )
    })?;
    let rendered = tmpl.render(Value::from_serialize(&data)).map_err(|e| {
        ApiError::new(StatusCode::BAD_REQUEST, "template_render_error", e.to_string())
    })?;

    let _slot = compile_slots().acquire().await.map_err(|e| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "task_join_error",
            e.to_string(),
        )
    })?;
    match tokio::task::spawn_blocking(move || compile_pdf(rendered, request_id, assets)).await {
        Ok(Ok(bytes)) => Ok(bytes),
        Ok(Err(e)) => Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "typst_compile_error",
            e,
        )),
        Err(e) => Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "task_join_error",
            e.to_string(),
        )),
    }
}

async fn generate_pdf(
    payload: Result<Json<GenerateRequest>, JsonRejection>,
) -> Result<Response, ApiError> {
    let payload = match payload {
        Ok(Json(body)) => body,
        Err(e) => return Err(ApiError::new(e.status(), "invalid_request", e.body_text())),
    };
    let assets = decode_assets(&payload.assets)?;
    let pdf_bytes = render_pdf(&payload.template, payload.data, assets).await?;
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/pdf"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"output.pdf\"",
            ),
        ],
        pdf_bytes,
    )
        .into_response())
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if store::run_cli(&args).await {
        return;
    }
    let cfg = config::get();
    store::init().await;

    let mut app = Router::new().route("/health", get(health));
    if cfg.enable_generate_pdf {
        app = app.route("/generate-pdf", post(generate_pdf));
    }
    let app = app
        .nest("/v1", v1::router())
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BODY_BYTES))
        .layer(config::cors_layer());

    // Warm up fonts and package cache so the first request is fast
    tokio::task::spawn_blocking(|| {
        let _ = compile_pdf(
            String::from("#import \"@preview/invoice-pro:0.5.0\": *\n"),
            REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed),
            Vec::new(),
        );
    });

    let listener = tokio::net::TcpListener::bind(&cfg.bind_addr)
        .await
        .unwrap_or_else(|e| panic!("Failed to bind to {}: {e}", cfg.bind_addr));

    println!("🚀 PDFCraft backend listening on http://{}", cfg.bind_addr);
    println!("   GET  /health               — health check");
    if cfg.enable_generate_pdf {
        println!("   POST /generate-pdf         — compile a Typst template to PDF");
    } else {
        println!("   POST /generate-pdf         — disabled (ENABLE_GENERATE_PDF=false)");
    }
    if cfg.api_keys.is_empty() && !store::has_database() {
        println!("   POST /v1/invoices[/bulk]   — disabled (set API_KEYS or DATABASE_URL to enable)");
    } else {
        println!("   POST /v1/invoices          — one invoice -> PDF (API key required)");
        println!("   POST /v1/invoices/bulk     — many invoices -> ZIP (API key required)");
        println!(
            "   API keys: {}; rate limit: {}",
            if store::has_database() { "Postgres" } else { "API_KEYS" },
            if store::has_redis() { "Redis (shared)" } else { "in-memory (per instance)" }
        );
    }

    axum::serve(listener, app).await.expect("Server error");
}
