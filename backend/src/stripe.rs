//! Purchased tokens via Stripe (feature flag `PAID_TOKENS_ENABLED`, off by default).
//!
//! Stripe calls `POST /v1/stripe/webhook` after a successful transaction; only then a
//! token is created or extended. Nothing but the token (hashed), its plan and its end
//! date is stored; no customer, company or payment data.
//!
//! * `checkout.session.completed` (paid): creates a token, or extends the token named
//!   in the session metadata `token_id`. Session metadata: `plan` (a `PAID_PLANS`
//!   name), `days` (lifetime, 1..=366) and optionally `token_id`.
//! * `invoice.paid` (`subscription_cycle`): moves the end of the subscription's token
//!   to the paid period end plus `PAID_GRACE_DAYS`.
//! * The new plain token is handed over once through `GET /v1/tokens/claim` (the
//!   checkout session id acts as the secret), because it is only known to the backend.

use crate::config;
use crate::store::{self, Kind};
use crate::ApiError;
use axum::{
    body::Bytes,
    extract::Query,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const TOLERANCE_SECS: u64 = 300;
const CLAIM_PREFIX: &str = "pdfcraft:claim:";
const SESSION_PREFIX: &str = "pdfcraft:stripe:session:";
const SUBSCRIPTION_PREFIX: &str = "pdfcraft:stripe:sub:";
const DAY: u64 = 86_400;

fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut k = [0u8; BLOCK];
    if key.len() > BLOCK {
        k[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha256::new();
    inner.update(k.map(|b| b ^ 0x36));
    inner.update(message);
    let mut outer = Sha256::new();
    outer.update(k.map(|b| b ^ 0x5c));
    outer.update(inner.finalize());
    outer.finalize().into()
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Checks the `Stripe-Signature` header (`t=…,v1=…`) against the raw body.
fn verify_signature(header: &str, body: &[u8], secret: &str, now: u64) -> bool {
    let mut timestamp = None;
    let mut signatures = Vec::new();
    for part in header.split(',') {
        match part.trim().split_once('=') {
            Some(("t", v)) => timestamp = v.parse::<u64>().ok(),
            Some(("v1", v)) => signatures.push(v),
            _ => {}
        }
    }
    let Some(t) = timestamp else { return false };
    if now.abs_diff(t) > TOLERANCE_SECS {
        return false;
    }
    let mut signed = format!("{t}.").into_bytes();
    signed.extend_from_slice(body);
    let expected = to_hex(&hmac_sha256(secret.as_bytes(), &signed));
    signatures.iter().any(|s| constant_time_eq(s.as_bytes(), expected.as_bytes()))
}

fn disabled() -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, "not_found", "purchased tokens are not enabled")
}

fn store_unavailable() -> ApiError {
    ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "store_unavailable", "token store is not reachable")
}

fn str_at<'a>(v: &'a Value, path: &[&str]) -> Option<&'a str> {
    path.iter().try_fold(v, |acc, k| acc.get(*k))?.as_str()
}

fn bad(details: &str) -> ApiError {
    ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_event", details)
}

async fn checkout_completed(session: &Value) -> Result<(), ApiError> {
    if str_at(session, &["payment_status"]) != Some("paid") {
        return Ok(());
    }
    let session_id = str_at(session, &["id"]).ok_or_else(|| bad("session id missing"))?;
    let days: u64 = str_at(session, &["metadata", "days"])
        .and_then(|d| d.parse().ok())
        .filter(|d| (1..=366).contains(d))
        .ok_or_else(|| bad("metadata.days must be 1..=366"))?;

    // Handle every session once, even if Stripe delivers the event repeatedly
    let marker = format!("{SESSION_PREFIX}{session_id}");
    if !store::mark_once(&marker, 30 * DAY).await.map_err(|_| store_unavailable())? {
        return Ok(());
    }
    let result = apply_checkout(session, session_id, days).await;
    if result.is_err() {
        // Let Stripe's retry run again
        let _ = store::delete_key(&marker).await;
    }
    result
}

async fn apply_checkout(session: &Value, session_id: &str, days: u64) -> Result<(), ApiError> {
    if let Some(token_id) = str_at(session, &["metadata", "token_id"]) {
        // Renewal of an existing token by its id; the transaction was successful
        return match store::extend_paid_token(token_id, days * DAY).await {
            Ok(Some(_)) => Ok(()),
            Ok(None) => Err(bad("token_id is unknown or past its retention period")),
            Err(_) => Err(store_unavailable()),
        };
    }

    let plan = str_at(session, &["metadata", "plan"]).ok_or_else(|| bad("metadata.plan missing"))?;
    let limit = config::get().plan_limit(plan).ok_or_else(|| bad("unknown plan"))?;
    let created = store::create_token(Kind::Paid, plan, limit, days * DAY)
        .await
        .map_err(|_| store_unavailable())?;

    let claim = json!({ "token": created.token, "expiresAt": created.valid_until, "plan": plan, "limitPerMinute": limit });
    store::put(&format!("{CLAIM_PREFIX}{session_id}"), &claim.to_string(), 3600)
        .await
        .map_err(|_| store_unavailable())?;

    if let Some(subscription) = str_at(session, &["subscription"]) {
        let ttl = config::get().paid_retention_days.max(1) * 2 * DAY;
        store::put(&format!("{SUBSCRIPTION_PREFIX}{subscription}"), &created.id, ttl)
            .await
            .map_err(|_| store_unavailable())?;
    }
    Ok(())
}

async fn invoice_paid(invoice: &Value) -> Result<(), ApiError> {
    if str_at(invoice, &["billing_reason"]) != Some("subscription_cycle") {
        return Ok(());
    }
    let Some(subscription) = str_at(invoice, &["subscription"]) else { return Ok(()) };
    let Some(period_end) = invoice
        .pointer("/lines/data/0/period/end")
        .and_then(Value::as_u64)
    else {
        return Err(bad("invoice period end missing"));
    };
    let Some(token_id) = store::get_value(&format!("{SUBSCRIPTION_PREFIX}{subscription}"))
        .await
        .map_err(|_| store_unavailable())?
    else {
        return Err(bad("unknown subscription"));
    };
    let until = period_end + config::get().paid_grace_days * DAY;
    match store::extend_paid_token_to(&token_id, until).await {
        Ok(Some(_)) => Ok(()),
        Ok(None) => Err(bad("token of the subscription no longer exists")),
        Err(_) => Err(store_unavailable()),
    }
}

/// `POST /v1/stripe/webhook`
pub async fn webhook(headers: HeaderMap, body: Bytes) -> Result<Response, ApiError> {
    let cfg = config::get();
    if !cfg.paid_tokens_enabled {
        return Err(disabled());
    }
    let Some(secret) = &cfg.stripe_webhook_secret else {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "stripe_not_configured",
            "STRIPE_WEBHOOK_SECRET is not set",
        ));
    };
    let signature = headers.get("stripe-signature").and_then(|v| v.to_str().ok()).unwrap_or("");
    if !verify_signature(signature, &body, secret, store::now()) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "invalid_signature", "Stripe signature check failed"));
    }
    let event: Value = serde_json::from_slice(&body).map_err(|e| bad(&e.to_string()))?;
    let object = event.pointer("/data/object").cloned().unwrap_or(Value::Null);
    match str_at(&event, &["type"]) {
        Some("checkout.session.completed") | Some("checkout.session.async_payment_succeeded") => {
            checkout_completed(&object).await?
        }
        Some("invoice.paid") => invoice_paid(&object).await?,
        _ => {}
    }
    Ok(Json(json!({ "received": true })).into_response())
}

#[derive(Deserialize)]
pub struct ClaimQuery {
    session_id: String,
}

/// `GET /v1/tokens/claim?session_id=cs_…`: returns the token of a finished purchase once.
pub async fn claim(Query(q): Query<ClaimQuery>) -> Result<Response, ApiError> {
    if !config::get().paid_tokens_enabled {
        return Err(disabled());
    }
    let valid_id = q.session_id.len() <= 200
        && q.session_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
    let found = if valid_id {
        store::take_value(&format!("{CLAIM_PREFIX}{}", q.session_id)).await.map_err(|_| store_unavailable())?
    } else {
        None
    };
    match found {
        Some(json) => Ok((
            StatusCode::OK,
            [("content-type", "application/json"), ("cache-control", "no-store")],
            json,
        )
            .into_response()),
        None => Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "not_found",
            "no token waiting for this session (payment pending, or already collected)",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_matches_rfc4231() {
        let mac = hmac_sha256(b"Jefe", b"what do ya want for nothing?");
        assert_eq!(to_hex(&mac), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    }

    #[test]
    fn signature_checks_time_and_body() {
        let body = br#"{"a":1}"#;
        let t = 1_700_000_000u64;
        let mut signed = format!("{t}.").into_bytes();
        signed.extend_from_slice(body);
        let sig = to_hex(&hmac_sha256(b"whsec_test", &signed));
        let header = format!("t={t},v1={sig}");
        assert!(verify_signature(&header, body, "whsec_test", t + 10));
        assert!(!verify_signature(&header, b"{}", "whsec_test", t + 10));
        assert!(!verify_signature(&header, body, "whsec_other", t + 10));
        assert!(!verify_signature(&header, body, "whsec_test", t + 10_000));
        assert!(!verify_signature("garbage", body, "whsec_test", t));
    }
}
