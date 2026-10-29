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
    conversions::IntoFileId, file_resolver::FileResolver,
    typst_kit_options::TypstKitFontOptions, TypstEngine, TypstTemplateCollection,
};

const MAX_REQUEST_BODY_BYTES: usize = 512 * 1024;

type Sources = Arc<Mutex<HashMap<FileId, Source>>>;

struct RequestSources(Sources);

impl FileResolver for RequestSources {
    fn resolve_binary(&self, id: FileId) -> FileResult<Cow<'_, Bytes>> {
        Err(FileError::NotFound(id.vpath().get_without_slash().into()))
    }

    fn resolve_source(&self, id: FileId) -> FileResult<Cow<'_, Source>> {
        match self.0.lock().unwrap().get(&id) {
            Some(src) => Ok(Cow::Owned(src.clone())),
            None => Err(FileError::NotFound(id.vpath().get_without_slash().into())),
        }
    }
}

struct Compiler {
    engine: TypstEngine<TypstTemplateCollection>,
    sources: Sources,
}

static COMPILER: OnceLock<Compiler> = OnceLock::new();
static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(0);

fn compiler() -> &'static Compiler {
    COMPILER.get_or_init(|| {
        let sources: Sources = Arc::default();
        let engine = TypstEngine::builder()
            .search_fonts_with(TypstKitFontOptions::default())
            .add_file_resolver(RequestSources(sources.clone()))
            .with_package_file_resolver()
            .comemo_evict_max_age(Some(10))
            .build();
        Compiler { engine, sources }
    })
}

fn compile_pdf(rendered: String) -> Result<Vec<u8>, String> {
    let started = std::time::Instant::now();
    let c = compiler();
    let name = format!("/req-{}.typ", REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed));
    let id = name.as_str().into_file_id();
    c.sources
        .lock()
        .unwrap()
        .insert(id, Source::new(id, rendered));

    let result = c.engine.with_world(id, |world| {
        let doc = typst::compile(world)
            .output
            .map_err(|e| format!("Typst compilation error: {e:?}"))?;
        let compiled = started.elapsed();
        let pdf = typst_pdf::pdf(&doc, &Default::default())
            .map_err(|e| format!("Typst PDF generation error: {e:?}"))?;
        println!(
            "typst layout: {compiled:?}, pdf export: {:?}",
            started.elapsed() - compiled
        );
        Ok(pdf)
    });

    c.sources.lock().unwrap().remove(&id);
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

        let ctx = Value::from_serialize(&payload.data);
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
    let pdf_bytes = match tokio::task::spawn_blocking(move || compile_pdf(rendered))
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
        let _ = compile_pdf(String::from("#import \"@preview/invoice-pro:0.3.2\": *\n"));
    });

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("Failed to bind to port 3000");

    println!("🚀 PDFCraft backend listening on http://0.0.0.0:3000");
    println!("   POST /generate-pdf  — compile Typst template to PDF");
    println!("   GET  /health        — health check");

    axum::serve(listener, app).await.expect("Server error");
}

