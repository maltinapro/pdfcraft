//! `POST /v1/client-errors`: privacy-friendly counting of front-end errors (E12-08, W-01).
//!
//! The browser reports only an allow-listed `kind` (for example a failed PDF preview). The backend
//! counts it in `pdfcraft_client_errors_total{kind, browser}`, where `browser` is a coarse bucket
//! derived from the User-Agent. Nothing else is stored or logged: no message, URL, stack or IP.
//!
//! Abuse protection: the request needs a valid Anubis pass (like `/v1/free-token`), and every
//! pass counts each kind at most once (a Valkey marker that lives as long as the pass). Without a
//! reachable store the report is dropped.

use crate::store;
use crate::ApiError;
use axum::{extract::Request, http::header, http::StatusCode, response::IntoResponse, Json};
use serde::Deserialize;

/// What the front end may report; anything else is rejected, so the label set stays small.
pub const KINDS: &[&str] = &["preview_render", "pdf_worker", "fetch_failed", "chunk_load"];

#[derive(Deserialize)]
struct Report {
    kind: String,
}

/// Coarse browser family of a User-Agent string (never stored, only mapped to a fixed label).
pub fn browser_bucket(user_agent: &str) -> &'static str {
    let ua = user_agent;
    let android = ua.contains("Android");
    let ios = ua.contains("iPhone") || ua.contains("iPad") || ua.contains("iPod");
    if ua.contains("SamsungBrowser") {
        "samsung"
    } else if ua.contains("; wv)") || (ios && !ua.contains("Safari/")) {
        "webview"
    } else if ua.contains("Firefox/") || ua.contains("FxiOS/") {
        "firefox"
    } else if ios {
        "safari-ios"
    } else if ua.contains("Chrome/") || ua.contains("CriOS/") || ua.contains("Edg/") {
        if android {
            "chrome-android"
        } else {
            "chrome"
        }
    } else if ua.contains("Safari/") && ua.contains("Version/") {
        "safari"
    } else {
        "other"
    }
}

pub async fn report(req: Request) -> Result<impl IntoResponse, ApiError> {
    let browser = browser_bucket(
        req.headers()
            .get(header::USER_AGENT)
            .and_then(|v| v.to_str().ok())
            .unwrap_or(""),
    );
    let Some((jwt, exp)) = crate::free::verified_pass(&req) else {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "challenge_required",
            "solve the Anubis challenge first (open the app page in a browser)",
        ));
    };
    let marker_base = format!("pdfcraft:clienterr:{}", store::hash_secret(jwt));
    let body = axum::body::to_bytes(req.into_body(), 1024)
        .await
        .map_err(|_| {
            ApiError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "invalid_request",
                "request body too large",
            )
        })?;
    let Json(Report { kind }) = Json::from_bytes(&body).map_err(|_| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "expected {\"kind\": \"...\"}",
        )
    })?;
    let Some(kind) = KINDS.iter().find(|k| **k == kind) else {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "validation_error",
            "kind must be one of preview_render, pdf_worker, fetch_failed, chunk_load",
        ));
    };
    let remaining = exp.saturating_sub(store::now());
    if let Ok(true) = store::mark_once(&format!("{marker_base}:{kind}"), remaining).await {
        crate::metrics::client_error(kind, browser);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::browser_bucket;

    #[test]
    fn maps_user_agents_to_coarse_buckets() {
        let cases = [
            ("Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36", "chrome-android"),
            ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", "chrome"),
            ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "safari-ios"),
            ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", "safari"),
            ("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0", "firefox"),
            ("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36", "samsung"),
            ("Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36", "webview"),
            ("curl/8.0", "other"),
            ("", "other"),
        ];
        for (ua, bucket) in cases {
            assert_eq!(browser_bucket(ua), bucket, "{ua}");
        }
    }
}
