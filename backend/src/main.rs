mod facturx;

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
use tower_http::cors::{Any, CorsLayer};
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

fn json_error(status: StatusCode, error: &'static str, details: String) -> Response {
    (status, Json(ErrorResponse { error, details })).into_response()
}

async fn generate_pdf(payload: Result<Json<GenerateRequest>, JsonRejection>) -> Response {
    let payload = match payload {
        Ok(Json(body)) => body,
        Err(e) => {
            let status = e.status();
            return json_error(status, "invalid_request", e.body_text());
        }
    };

    let request_id = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);

    if payload.assets.len() > MAX_ASSETS {
        return json_error(
            StatusCode::BAD_REQUEST,
            "invalid_asset",
            format!("at most {MAX_ASSETS} assets are allowed"),
        );
    }
    let mut decoded_assets: Vec<(String, Vec<u8>)> = Vec::new();
    for (key, encoded) in &payload.assets {
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric()) {
            return json_error(
                StatusCode::BAD_REQUEST,
                "invalid_asset",
                format!("asset key `{key}` must be alphanumeric"),
            );
        }
        match BASE64.decode(encoded) {
            Ok(bytes) if bytes.len() <= MAX_ASSET_BYTES => {
                decoded_assets.push((key.clone(), bytes))
            }
            Ok(_) => {
                return json_error(
                    StatusCode::BAD_REQUEST,
                    "invalid_asset",
                    format!("asset `{key}` exceeds {MAX_ASSET_BYTES} bytes"),
                );
            }
            Err(e) => {
                return json_error(
                    StatusCode::BAD_REQUEST,
                    "invalid_asset",
                    format!("asset `{key}` is not valid base64: {e}"),
                );
            }
        }
    }

    let mut data = payload.data;
    if !decoded_assets.is_empty() {
        let paths: serde_json::Map<String, JsonValue> = decoded_assets
            .iter()
            .map(|(key, _)| (key.clone(), JsonValue::String(asset_path(request_id, key))))
            .collect();
        match data.as_object_mut() {
            Some(obj) => {
                obj.insert("assets".into(), JsonValue::Object(paths));
            }
            None => {
                return json_error(
                    StatusCode::BAD_REQUEST,
                    "invalid_request",
                    "`data` must be an object when assets are used".into(),
                );
            }
        }
    }

    // Step 1: Render the template with minijinja
    let rendered = {
        let mut env = Environment::new();

        if let Err(e) = env.add_template("doc", &payload.template) {
            return json_error(
                StatusCode::BAD_REQUEST,
                "template_parse_error",
                e.to_string(),
            );
        }

        let tmpl = match env.get_template("doc") {
            Ok(t) => t,
            Err(e) => {
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "template_load_error",
                    e.to_string(),
                );
            }
        };

        let ctx = Value::from_serialize(&data);
        match tmpl.render(ctx) {
            Ok(s) => s,
            Err(e) => {
                return json_error(
                    StatusCode::BAD_REQUEST,
                    "template_render_error",
                    e.to_string(),
                );
            }
        }
    };

    // Step 2: Compile Typst → PDF using the shared engine (fonts/packages cached)
    let pdf_bytes = match tokio::task::spawn_blocking(move || compile_pdf(rendered, request_id, decoded_assets))
    .await
    {
        Ok(Ok(bytes)) => bytes,
        Ok(Err(e)) => {
            return json_error(StatusCode::UNPROCESSABLE_ENTITY, "typst_compile_error", e);
        }
        Err(e) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "task_join_error",
                e.to_string(),
            );
        }
    };

    // Step 3: Return PDF with appropriate headers
    (
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
        .into_response()
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

#[tokio::main]
async fn main() {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/generate-pdf", post(generate_pdf))
        .route("/health", get(health))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BODY_BYTES))
        .layer(cors);

    // Warm up fonts and package cache so the first request is fast
    tokio::task::spawn_blocking(|| {
        let _ = compile_pdf(
            String::from("#import \"@preview/invoice-pro:0.5.0\": *\n"),
            REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed),
            Vec::new(),
        );
    });

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("Failed to bind to port 3000");

    println!("🚀 PDFCraft backend listening on http://0.0.0.0:3000");
    println!("   POST /generate-pdf  — compile Typst template to PDF");
    println!("   GET  /health        — health check");

    axum::serve(listener, app).await.expect("Server error");
}

