//! Purchased tokens via Mollie (feature flag `PAID_TOKENS_ENABLED`, off by default).
//!
//! * `POST /v1/checkout` creates a Mollie payment for an offer from `PAID_PRICES` and
//!   returns its `checkoutUrl`. The payment `metadata` carries `plan`, `days`, `order`
//!   (a random secret of the buyer) and optionally `token_id` (renewal) and
//!   `subscription`.
//! * Mollie calls `POST /v1/mollie/webhook` with only a payment id (`id=tr_…`) and no
//!   signature. The backend therefore fetches the payment from the Mollie API with
//!   `MOLLIE_API_KEY` and trusts only that answer. A paid payment creates a token, or
//!   extends the token named in `token_id`.
//! * Subscriptions: the first payment (`sequenceType=first`, with a Mollie customer)
//!   creates the mandate; once it is paid, the backend creates the subscription. Its
//!   metadata remembers the token id, so every later `recurring` payment moves the
//!   token's end to now + the interval + `PAID_GRACE_DAYS`.
//! * The new plain token is handed over once through `GET /v1/tokens/claim?order=…`.
//!
//! Nothing but the token (hashed), its plan and its end date is stored by PDFCraft; no
//! customer, company or payment data (Mollie keeps the payment and the customer).

use crate::config;
use crate::store::{self, Client, Kind};
use crate::ApiError;
use axum::{
    body::Bytes,
    extract::{rejection::JsonRejection, Extension, Json, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use reqwest::Method;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{sync::OnceLock, time::Duration};

const CLAIM_PREFIX: &str = "pdfcraft:claim:";
const PAYMENT_PREFIX: &str = "pdfcraft:mollie:payment:";
const TOKEN_PREFIX: &str = "pdfcraft:mollie:token:";
const SUBSCRIBED_PREFIX: &str = "pdfcraft:mollie:subscribed:";
const SUBSCRIPTION_OF_PREFIX: &str = "pdfcraft:mollie:sub-of:";
const PRODUCT: &str = "pdfcraft-token";
const DAY: u64 = 86_400;

fn disabled() -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, "not_found", "purchases are not enabled")
}

fn ensure_enabled() -> Result<(), ApiError> {
    config::get().mollie_enabled().then_some(()).ok_or_else(disabled)
}

fn store_unavailable() -> ApiError {
    ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "store_unavailable", "token store is not reachable")
}

fn bad(details: &str) -> ApiError {
    ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_payment", details)
}

fn upstream(details: &str) -> ApiError {
    ApiError::new(StatusCode::BAD_GATEWAY, "payment_upstream_error", details)
}

fn not_configured(what: &str) -> ApiError {
    ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "mollie_not_configured", format!("{what} is not set"))
}

fn str_at<'a>(v: &'a Value, path: &[&str]) -> Option<&'a str> {
    path.iter().try_fold(v, |acc, k| acc.get(*k))?.as_str()
}

/// Mollie returns metadata as sent; numbers may come back as numbers or strings.
fn days_at(v: &Value, path: &[&str]) -> Option<u64> {
    let value = path.iter().try_fold(v, |acc, k| acc.get(*k))?;
    value.as_u64().or_else(|| value.as_str()?.parse().ok()).filter(|d| (1..=366).contains(d))
}

/// `YYYY-MM-DD` (UTC) of a Unix timestamp.
fn ymd(ts: u64) -> String {
    let z = (ts / DAY) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

/// Mollie ids (`cst_…`, `sub_…`) go into URL paths, so only plain characters are allowed.
fn valid_ref(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn valid_payment_id(id: &str) -> bool {
    id.strip_prefix("tr_").is_some_and(|rest| (1..=60).contains(&rest.len()) && rest.bytes().all(|b| b.is_ascii_alphanumeric()))
}

/// The webhook body is `id=tr_…` (form encoded).
fn payment_id(body: &[u8]) -> Option<String> {
    let body = std::str::from_utf8(body).ok()?;
    let id = body.split('&').find_map(|pair| pair.strip_prefix("id="))?;
    valid_payment_id(id).then(|| id.to_string())
}

static HTTP: OnceLock<reqwest::Client> = OnceLock::new();

/// Calls the Mollie API; returns the status and the JSON body (`Null` if it has none).
async fn call(method: Method, path: &str, body: Option<Value>, idempotency: Option<&str>) -> Result<(StatusCode, Value), ApiError> {
    let cfg = config::get();
    let key = cfg.mollie_api_key.as_deref().ok_or_else(|| not_configured("MOLLIE_API_KEY"))?;
    if !cfg.mollie_api_url.starts_with("https://") && !crate::internetmarke::is_loopback(&cfg.mollie_api_url) {
        return Err(ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "mollie_not_configured", "MOLLIE_API_URL must use https"));
    }
    let http = HTTP.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(concat!("pdfcraft/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP client")
    });
    let mut request = http.request(method, format!("{}{path}", cfg.mollie_api_url)).bearer_auth(key);
    if let Some(key) = idempotency {
        request = request.header("Idempotency-Key", key);
    }
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|e| {
        tracing::warn!(event = "mollie_upstream", reason = if e.is_timeout() { "timeout" } else { "request failed" });
        upstream("Mollie is not reachable")
    })?;
    let status = response.status();
    let json = response.json::<Value>().await.unwrap_or(Value::Null);
    Ok((status, json))
}

/// Like `call`, but every answer except 2xx is an error.
async fn call_ok(method: Method, path: &str, body: Option<Value>, idempotency: Option<&str>) -> Result<Value, ApiError> {
    let (status, json) = call(method, path, body, idempotency).await?;
    if status.is_success() {
        return Ok(json);
    }
    tracing::warn!(event = "mollie_error", status = status.as_u16(), detail = str_at(&json, &["detail"]).unwrap_or(""));
    Err(upstream("Mollie rejected the request"))
}

// ---------------------------------------------------------------- checkout

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckoutRequest {
    plan: String,
    days: u64,
    #[serde(default)]
    subscription: bool,
    /// Renewal: id of an existing purchased token
    token_id: Option<String>,
    /// `de` or `en`: language of Mollie's checkout page (default: Mollie decides)
    locale: Option<String>,
}

fn redirect_url(base: &str, order: &str) -> Result<String, ApiError> {
    let mut url = reqwest::Url::parse(base).map_err(|_| not_configured("a valid MOLLIE_REDIRECT_URL"))?;
    url.query_pairs_mut().append_pair("order", order);
    Ok(url.into())
}

/// `POST /v1/checkout`: `{plan, days, subscription?, tokenId?, locale?}` -> `{checkoutUrl, order}`
pub async fn checkout(payload: Result<Json<CheckoutRequest>, JsonRejection>) -> Result<Response, ApiError> {
    ensure_enabled()?;
    let cfg = config::get();
    let Json(req) = payload.map_err(|e| ApiError::new(e.status(), "invalid_request", e.body_text()))?;
    let plan = req.plan.trim().to_ascii_lowercase();
    let price = cfg
        .price(&plan, req.days)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "unknown_offer", "no offer for this plan and number of days"))?;
    let public = cfg.public_url.as_deref().ok_or_else(|| not_configured("PUBLIC_URL"))?;
    let success = cfg.mollie_redirect_url.as_deref().ok_or_else(|| not_configured("MOLLIE_REDIRECT_URL"))?;

    if let Some(id) = &req.token_id {
        if !store::paid_token_exists(id).await.map_err(|_| store_unavailable())? {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "unknown_token", "tokenId is unknown or past its retention period"));
        }
    }
    let locale = match req.locale.as_deref() {
        None => None,
        Some("de") => Some("de_DE"),
        Some("en") => Some("en_GB"),
        Some(_) => return Err(ApiError::new(StatusCode::BAD_REQUEST, "invalid_request", "locale must be `de` or `en`")),
    };

    let order = store::random_hex(16);
    let mut metadata = json!({ "product": PRODUCT, "plan": plan, "days": req.days, "order": order });
    if let Some(id) = &req.token_id {
        metadata["token_id"] = json!(id);
    }
    metadata["subscription"] = json!(req.subscription);

    let mut payment = json!({
        "amount": { "currency": cfg.paid_currency, "value": price.amount },
        "description": format!("PDFCraft {plan}, {} days", req.days),
        "redirectUrl": redirect_url(success, &order)?,
        "webhookUrl": format!("{public}/v1/mollie/webhook"),
        "metadata": metadata,
    });
    if let Some(locale) = locale {
        payment["locale"] = json!(locale);
    }
    if req.subscription {
        // A first payment creates the mandate for the later charges; the customer stays empty
        let customer = call_ok(Method::POST, "/customers", Some(json!({})), None).await?;
        let customer_id = str_at(&customer, &["id"]).ok_or_else(|| upstream("Mollie returned no customer"))?;
        payment["sequenceType"] = json!("first");
        payment["customerId"] = json!(customer_id);
    }

    let created = call_ok(Method::POST, "/payments", Some(payment), Some(&format!("pdfcraft-order-{order}"))).await?;
    let url = str_at(&created, &["_links", "checkout", "href"]).ok_or_else(|| upstream("Mollie returned no checkout link"))?;
    tracing::info!(event = "checkout_created", token_plan = %plan, days = req.days, subscription = req.subscription, renewal = req.token_id.is_some());
    Ok((
        StatusCode::OK,
        [("cache-control", "no-store")],
        Json(json!({ "checkoutUrl": url, "order": order })),
    )
        .into_response())
}

/// `GET /v1/checkout/offers`: what the frontend may sell; `{"enabled": false}` while purchases are off.
pub async fn offers() -> Response {
    let cfg = config::get();
    let body = if cfg.mollie_enabled() {
        let offers: Vec<Value> = cfg
            .paid_prices
            .iter()
            .filter_map(|p| {
                let limit = cfg.plan_limit(&p.plan)?;
                Some(json!({ "plan": p.plan, "days": p.days, "amount": p.amount, "limitPerMinute": limit }))
            })
            .collect();
        json!({ "enabled": !offers.is_empty(), "currency": cfg.paid_currency, "offers": offers })
    } else {
        json!({ "enabled": false })
    };
    ([("cache-control", "no-store")], Json(body)).into_response()
}

// ------------------------------------------------------------------ webhook

async fn purchase_paid(payment: &Value, payment_id: &str) -> Result<(), ApiError> {
    let days = days_at(payment, &["metadata", "days"]).ok_or_else(|| bad("metadata.days must be 1..=366"))?;
    let plan = str_at(payment, &["metadata", "plan"]).ok_or_else(|| bad("metadata.plan missing"))?.to_string();

    // Handle every payment once, even if Mollie calls the webhook repeatedly
    let marker = format!("{PAYMENT_PREFIX}{payment_id}");
    if store::mark_once(&marker, 30 * DAY).await.map_err(|_| store_unavailable())? {
        if let Err(e) = apply_purchase(payment, payment_id, &plan, days).await {
            // Let Mollie's retry run again
            let _ = store::delete_key(&marker).await;
            return Err(e);
        }
    }

    if payment.pointer("/metadata/subscription").and_then(Value::as_bool) == Some(true) {
        start_subscription(payment, payment_id, &plan, days).await?;
    }
    Ok(())
}

async fn apply_purchase(payment: &Value, payment_id: &str, plan: &str, days: u64) -> Result<(), ApiError> {
    let token_id = if let Some(token_id) = str_at(payment, &["metadata", "token_id"]) {
        // Renewal of an existing token by its id; the payment is confirmed by Mollie
        match store::extend_paid_token(token_id, days * DAY).await {
            Ok(Some(until)) => {
                tracing::info!(event = "token_extended", token_id, token_kind = "paid", reason = "checkout", until);
                token_id.to_string()
            }
            Ok(None) => return Err(bad("token_id is unknown or past its retention period")),
            Err(_) => return Err(store_unavailable()),
        }
    } else {
        let order = str_at(payment, &["metadata", "order"]).ok_or_else(|| bad("metadata.order missing"))?;
        let limit = config::get().plan_limit(plan).ok_or_else(|| bad("unknown plan"))?;
        let created = store::create_token(Kind::Paid, plan, limit, days * DAY)
            .await
            .map_err(|_| store_unavailable())?;
        tracing::info!(event = "token_created", token_id = %created.id, token_kind = "paid", token_plan = plan);
        let claim = json!({ "token": created.token, "expiresAt": created.valid_until, "plan": plan, "limitPerMinute": limit });
        store::put(&format!("{CLAIM_PREFIX}{order}"), &claim.to_string(), 3600)
            .await
            .map_err(|_| store_unavailable())?;
        created.id
    };
    // The subscription step may need the id on a later webhook call
    store::put(&format!("{TOKEN_PREFIX}{payment_id}"), &token_id, 30 * DAY)
        .await
        .map_err(|_| store_unavailable())
}

/// After the first payment: charge again every `days` days.
async fn start_subscription(payment: &Value, payment_id: &str, plan: &str, days: u64) -> Result<(), ApiError> {
    let cfg = config::get();
    let customer_id = str_at(payment, &["customerId"]).ok_or_else(|| bad("customerId missing for a subscription"))?;
    let price = cfg.price(plan, days).ok_or_else(|| bad("the offer no longer exists"))?;
    let public = cfg.public_url.as_deref().ok_or_else(|| not_configured("PUBLIC_URL"))?;
    let token_id = store::get_value(&format!("{TOKEN_PREFIX}{payment_id}"))
        .await
        .map_err(|_| store_unavailable())?
        .ok_or_else(|| bad("token of the payment is unknown"))?;

    let marker = format!("{SUBSCRIBED_PREFIX}{payment_id}");
    if !store::mark_once(&marker, 30 * DAY).await.map_err(|_| store_unavailable())? {
        return Ok(());
    }
    let body = json!({
        "amount": { "currency": cfg.paid_currency, "value": price.amount },
        "interval": format!("{days} days"),
        "startDate": ymd(store::now() + days * DAY),
        "description": format!("PDFCraft {plan}, {days} days"),
        "webhookUrl": format!("{public}/v1/mollie/webhook"),
        "metadata": { "product": PRODUCT, "token_id": token_id, "days": days },
    });
    let path = format!("/customers/{customer_id}/subscriptions");
    match call_ok(Method::POST, &path, Some(body), Some(&format!("pdfcraft-subscription-{payment_id}"))).await {
        Ok(created) => {
            tracing::info!(event = "subscription_created", token_id = %token_id, token_plan = plan);
            // Lets the token holder cancel it later; only Mollie ids, no customer data
            if let Some(subscription_id) = str_at(&created, &["id"]).filter(|id| valid_ref(id)) {
                let ttl = cfg.paid_retention_days.max(1) * 2 * DAY;
                store::put(&format!("{SUBSCRIPTION_OF_PREFIX}{token_id}"), &format!("{customer_id}/{subscription_id}"), ttl)
                    .await
                    .map_err(|_| store_unavailable())?;
            }
            Ok(())
        }
        Err(e) => {
            let _ = store::delete_key(&marker).await;
            Err(e)
        }
    }
}

/// A paid charge of a subscription: moves the token's end to now + interval + grace.
async fn renewal_paid(payment: &Value, payment_id: &str) -> Result<(), ApiError> {
    let customer_id = str_at(payment, &["customerId"]).ok_or_else(|| bad("customerId missing"))?;
    let subscription_id = str_at(payment, &["subscriptionId"]).ok_or_else(|| bad("subscriptionId missing"))?;
    if !valid_ref(subscription_id) || !valid_ref(customer_id) {
        return Err(bad("invalid customer or subscription id"));
    }

    let marker = format!("{PAYMENT_PREFIX}{payment_id}");
    if !store::mark_once(&marker, 30 * DAY).await.map_err(|_| store_unavailable())? {
        return Ok(());
    }
    let result = extend_for_subscription(customer_id, subscription_id).await;
    if result.is_err() {
        let _ = store::delete_key(&marker).await;
    }
    result
}

async fn extend_for_subscription(customer_id: &str, subscription_id: &str) -> Result<(), ApiError> {
    let subscription = call_ok(Method::GET, &format!("/customers/{customer_id}/subscriptions/{subscription_id}"), None, None).await?;
    if str_at(&subscription, &["metadata", "product"]) != Some(PRODUCT) {
        return Err(bad("not a PDFCraft subscription"));
    }
    let token_id = str_at(&subscription, &["metadata", "token_id"]).ok_or_else(|| bad("subscription metadata.token_id missing"))?;
    let days = days_at(&subscription, &["metadata", "days"]).ok_or_else(|| bad("subscription metadata.days missing"))?;
    let until = store::now() + (days + config::get().paid_grace_days) * DAY;
    match store::extend_paid_token_to(token_id, until).await {
        Ok(Some(until)) => {
            tracing::info!(event = "token_extended", token_id, token_kind = "paid", reason = "subscription_renewal", until);
            Ok(())
        }
        Ok(None) => Err(bad("token of the subscription no longer exists")),
        Err(_) => Err(store_unavailable()),
    }
}

/// `POST /v1/mollie/webhook` (form body `id=tr_…`, no signature: the payment is fetched from Mollie)
pub async fn webhook(body: Bytes) -> Result<Response, ApiError> {
    ensure_enabled()?;
    let id = payment_id(&body).ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "invalid_request", "form field `id` (tr_…) missing"))?;
    let (status, payment) = call(Method::GET, &format!("/payments/{id}"), None, None).await?;
    if status == StatusCode::NOT_FOUND {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "unknown_payment", "Mollie does not know this payment"));
    }
    if !status.is_success() {
        tracing::warn!(event = "mollie_error", status = status.as_u16());
        return Err(upstream("Mollie rejected the request"));
    }

    let (kind, result) = if str_at(&payment, &["status"]) != Some("paid") {
        ("other", Ok(()))
    } else if str_at(&payment, &["sequenceType"]) == Some("recurring") && payment.get("subscriptionId").is_some() {
        ("renewal", renewal_paid(&payment, &id).await)
    } else if str_at(&payment, &["metadata", "product"]) == Some(PRODUCT) {
        ("purchase", purchase_paid(&payment, &id).await)
    } else {
        ("other", Ok(()))
    };
    crate::metrics::mollie_event(kind, if result.is_ok() { "ok" } else { "error" });
    result?;
    Ok(StatusCode::OK.into_response())
}

// ----------------------------------------------------- the holder's token

/// `GET /v1/token` (with the token): kind, plan, limit, end and whether a subscription is running.
pub async fn token_info(Extension(client): Extension<Client>) -> Result<Response, ApiError> {
    let until = store::token_until(&client.id).await.map_err(|_| store_unavailable())?;
    let subscription = client.kind == Kind::Paid
        && store::get_value(&format!("{SUBSCRIPTION_OF_PREFIX}{}", client.id)).await.map_err(|_| store_unavailable())?.is_some();
    Ok((
        [("cache-control", "no-store")],
        Json(json!({
            "kind": client.kind.label(), "id": client.id, "plan": client.plan,
            "limitPerMinute": client.limit, "expiresAt": until, "subscription": subscription,
        })),
    )
        .into_response())
}

/// `POST /v1/subscription/cancel` (with the token): stops the Mollie subscription of this token.
/// The token stays valid until its current end; there will be no further charge.
pub async fn cancel_subscription(Extension(client): Extension<Client>) -> Result<Response, ApiError> {
    ensure_enabled()?;
    let no_subscription = || ApiError::new(StatusCode::NOT_FOUND, "no_subscription", "this token has no running subscription");
    if client.kind != Kind::Paid {
        return Err(no_subscription());
    }
    let key = format!("{SUBSCRIPTION_OF_PREFIX}{}", client.id);
    let stored = store::get_value(&key).await.map_err(|_| store_unavailable())?.ok_or_else(no_subscription)?;
    let (customer_id, subscription_id) = stored.split_once('/').filter(|(c, s)| valid_ref(c) && valid_ref(s)).ok_or_else(no_subscription)?;
    let (status, json) = call(Method::DELETE, &format!("/customers/{customer_id}/subscriptions/{subscription_id}"), None, None).await?;
    // 404: Mollie no longer knows it (already cancelled); either way nothing is charged any more
    if !status.is_success() && status != StatusCode::NOT_FOUND {
        crate::metrics::mollie_event("cancel", "error");
        tracing::warn!(event = "mollie_error", status = status.as_u16(), detail = str_at(&json, &["detail"]).unwrap_or(""));
        return Err(upstream("Mollie could not cancel the subscription"));
    }
    store::delete_key(&key).await.map_err(|_| store_unavailable())?;
    crate::metrics::mollie_event("cancel", "ok");
    tracing::info!(event = "subscription_cancelled", token_id = %client.id, token_plan = %client.plan);
    Ok(Json(json!({ "cancelled": true })).into_response())
}

// -------------------------------------------------------------------- claim

#[derive(Deserialize)]
pub struct ClaimQuery {
    order: String,
}

/// `GET /v1/tokens/claim?order=…`: returns the token of a finished purchase once.
pub async fn claim(Query(q): Query<ClaimQuery>) -> Result<Response, ApiError> {
    ensure_enabled()?;
    let valid_id = q.order.len() <= 64 && q.order.bytes().all(|b| b.is_ascii_alphanumeric());
    let found = if valid_id {
        store::take_value(&format!("{CLAIM_PREFIX}{}", q.order)).await.map_err(|_| store_unavailable())?
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
            "no token waiting for this order (payment pending, or already collected)",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_are_civil_utc() {
        assert_eq!(ymd(0), "1970-01-01");
        assert_eq!(ymd(951_782_400), "2000-02-29");
        assert_eq!(ymd(1_700_000_000), "2023-11-14");
        assert_eq!(ymd(1_700_000_000 + 31 * DAY), "2023-12-15");
    }

    #[test]
    fn webhook_body_needs_a_payment_id() {
        assert_eq!(payment_id(b"id=tr_WDqYK6vllg"), Some("tr_WDqYK6vllg".into()));
        assert_eq!(payment_id(b"foo=1&id=tr_abc"), Some("tr_abc".into()));
        assert_eq!(payment_id(b"id=sub_abc"), None);
        assert_eq!(payment_id(b"id=tr_../x"), None);
        assert_eq!(payment_id(b"id=tr_"), None);
        assert_eq!(payment_id(b""), None);
    }

    #[test]
    fn metadata_days_come_as_number_or_string() {
        let v = json!({ "metadata": { "a": 31, "b": "7", "c": 400, "d": "x" } });
        assert_eq!(days_at(&v, &["metadata", "a"]), Some(31));
        assert_eq!(days_at(&v, &["metadata", "b"]), Some(7));
        assert_eq!(days_at(&v, &["metadata", "c"]), None);
        assert_eq!(days_at(&v, &["metadata", "d"]), None);
    }

    #[test]
    fn redirect_keeps_existing_query() {
        assert_eq!(redirect_url("https://x.example/app/", "ab12").ok().as_deref(), Some("https://x.example/app/?order=ab12"));
        assert_eq!(redirect_url("https://x.example/app/?lang=de", "ab12").ok().as_deref(), Some("https://x.example/app/?lang=de&order=ab12"));
    }
}
