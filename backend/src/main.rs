use axum::{
    extract::Json,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use minijinja::{Environment, Value};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tower_http::cors::{Any, CorsLayer};

#[derive(Deserialize)]
struct GenerateRequest {
    template: String,
    data: JsonValue,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
}

async fn generate_pdf(Json(payload): Json<GenerateRequest>) -> Response {
    // Step 1: Render the template with minijinja
    let rendered = {
        let mut env = Environment::new();
        if let Err(e) = env.add_template("doc", &payload.template) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Template parse error: {e}"),
            )
                .into_response();
        }

        let tmpl = match env.get_template("doc") {
            Ok(t) => t,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Template load error: {e}"),
                )
                    .into_response()
            }
        };

        // Convert the JSON data to a minijinja Value via serde serialization
        let ctx = Value::from_serialize(&payload.data);
        match tmpl.render(ctx) {
            Ok(s) => s,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Template render error: {e}"),
                )
                    .into_response()
            }
        }
    };

    // Step 2: Compile LaTeX → PDF via tectonic in a blocking context
    let pdf_bytes = match tokio::task::spawn_blocking(move || {
        tectonic::latex_to_pdf(&rendered)
    })
    .await
    {
        Ok(Ok(bytes)) => bytes,
        Ok(Err(e)) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("LaTeX compilation error: {e}"),
            )
                .into_response()
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Task join error: {e}"),
            )
                .into_response()
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
        .layer(cors);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("Failed to bind to port 3000");

    println!("🚀 PDFCraft backend listening on http://0.0.0.0:3000");
    println!("   POST /generate-pdf  — compile LaTeX template to PDF");
    println!("   GET  /health        — health check");

    axum::serve(listener, app)
        .await
        .expect("Server error");
}

