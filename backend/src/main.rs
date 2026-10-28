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
use typst_as_lib::{typst_kit_options::TypstKitFontOptions, TypstEngine};

const MAX_REQUEST_BODY_BYTES: usize = 512 * 1024;

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

    // Step 2: Compile Typst → PDF via typst-as-lib in a blocking context
    let pdf_bytes = match tokio::task::spawn_blocking(move || {
        let engine = TypstEngine::builder()
            .main_file(rendered)
            .search_fonts_with(TypstKitFontOptions::default())
            .with_package_file_resolver()
            .build();

        let pdf_result = engine.with_world(|world| {
            let compile_result = typst::compile(world);
            let doc = compile_result
                .output
                .map_err(|e| format!("Typst compilation error: {e:?}"))?;

            typst_pdf::pdf(&doc, &Default::default())
                .map_err(|e| format!("Typst PDF generation error: {e:?}"))
        });

        match pdf_result {
            Ok(result) => result,
            Err(e) => Err(format!("Typst world setup error: {e}")),
        }
    })
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

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("Failed to bind to port 3000");

    println!("🚀 PDFCraft backend listening on http://0.0.0.0:3000");
    println!("   POST /generate-pdf  — compile Typst template to PDF");
    println!("   GET  /health        — health check");

    axum::serve(listener, app).await.expect("Server error");
}

