//! Version information for render snapshots: `GET /v1/version` and the `X-Pdfcraft-Version`
//! response header. Nothing here depends on a request, token or customer data.

use crate::{documents::Kind, metrics, v1::INVOICE_TEMPLATE};
use axum::{
    extract::{Json, Request},
    http::HeaderValue,
    middleware::Next,
    response::Response,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, sync::LazyLock};
use utoipa::ToSchema;

/// Name of the response header that carries the release version.
pub const VERSION_HEADER: &str = "x-pdfcraft-version";

/// Which build rendered a document; store it next to the input of every issued document.
#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    /// Release version (the image tag, e.g. `1.4.0`); the crate version for local builds.
    version: &'static str,
    /// Git commit the backend was built from; `unknown` for local builds.
    commit: &'static str,
    /// Version of the Typst compiler that lays out the PDFs.
    typst: &'static str,
    /// SHA-256 (hex) over the hashes of all templates; changes whenever any template changes.
    template_hash: String,
    /// SHA-256 (hex) of the complete Typst source (shared layout plus body) per template, by
    /// document type (`invoice`, `credit-note`, `offer`, ...).
    templates: BTreeMap<&'static str, String>,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn sha256_hex(text: &str) -> String {
    hex(&Sha256::digest(text.as_bytes()))
}

static INFO: LazyLock<VersionInfo> = LazyLock::new(|| {
    let mut templates = BTreeMap::new();
    templates.insert("invoice", sha256_hex(INVOICE_TEMPLATE));
    for kind in Kind::ALL {
        templates.insert(kind.slug(), sha256_hex(kind.template()));
    }
    let combined: String = templates
        .iter()
        .map(|(name, hash)| format!("{name}:{hash}\n"))
        .collect();
    VersionInfo {
        version: metrics::VERSION,
        commit: metrics::COMMIT,
        typst: typst::utils::version().raw(),
        template_hash: sha256_hex(&combined),
        templates,
    }
});

/// Version of this backend, its Typst compiler and its templates
///
/// Public: needs no token and costs no rate-limit unit. Also available as `GET /version` on the backend
/// itself (for probes that bypass the ingress, which only forwards `/v1`).
#[utoipa::path(
    get,
    path = "/v1/version",
    tag = "Version",
    operation_id = "getVersion",
    responses((status = 200, description = "The version of the running backend.", body = VersionInfo))
)]
pub async fn info() -> Json<VersionInfo> {
    Json(INFO.clone())
}

/// Adds `X-Pdfcraft-Version` to every response (PDFs, ZIPs and errors alike).
pub async fn version_header(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    if let Ok(value) = HeaderValue::from_str(metrics::VERSION) {
        response.headers_mut().insert(VERSION_HEADER, value);
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::StatusCode, routing::get, Router};

    async fn serve(app: Router) -> std::net::SocketAddr {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        addr
    }

    #[test]
    fn hashes_cover_every_template() {
        let info = &*INFO;
        assert_eq!(info.version, metrics::VERSION);
        assert_eq!(info.typst, typst::utils::version().raw());
        assert_eq!(info.templates.len(), Kind::ALL.len() + 1);
        for hash in info.templates.values().chain([&info.template_hash]) {
            assert_eq!(hash.len(), 64);
            assert!(hash.bytes().all(|b| b.is_ascii_hexdigit()));
        }
        assert_eq!(info.templates["invoice"], sha256_hex(INVOICE_TEMPLATE));
        assert_eq!(info.templates["offer"], sha256_hex(Kind::Offer.template()));
        assert_ne!(info.templates["invoice"], info.templates["offer"]);
    }

    #[tokio::test]
    async fn version_is_public_json_and_responses_carry_the_header() {
        let app = Router::new()
            .route("/version", get(info))
            .route("/missing-token", get(|| async { StatusCode::UNAUTHORIZED }))
            .layer(axum::middleware::from_fn(version_header));
        let addr = serve(app).await;

        let response = reqwest::get(format!("http://{addr}/version"))
            .await
            .unwrap();
        assert_eq!(response.headers()[VERSION_HEADER], metrics::VERSION);
        let body: serde_json::Value = response.json().await.unwrap();
        assert_eq!(body["version"], metrics::VERSION);
        assert_eq!(body["commit"], metrics::COMMIT);
        assert_eq!(body["typst"], typst::utils::version().raw());
        assert_eq!(body["templateHash"], INFO.template_hash);
        assert_eq!(body["templates"]["invoice"], INFO.templates["invoice"]);

        let error = reqwest::get(format!("http://{addr}/missing-token"))
            .await
            .unwrap();
        assert_eq!(error.status(), 401);
        assert_eq!(error.headers()[VERSION_HEADER], metrics::VERSION);
    }
}
