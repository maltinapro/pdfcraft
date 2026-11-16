//! Deutsche Post INTERNETMARKE integration: buys a franking mark (PNG) with the **user's own**
//! Portokasse account and hands it back to the browser, which sends it along with the document
//! (`postage`, see `postage.rs`).
//!
//! Nothing about a purchase is stored: the Portokasse login and the access token live only in the
//! request, nothing is written to Valkey except a hashed one-time request marker, and neither the
//! credentials nor the stamp are ever logged. Only the public product list (names, prices) is
//! cached in memory.
//!
//! Flow: `POST /user` (OAuth client credentials of this app + Portokasse login) ->
//! `POST /app/shoppingcart` -> `POST /app/shoppingcart/png?directCheckout=true` -> download of
//! the stamp (PNG, sometimes wrapped in a ZIP). Products and prices come from the Deutsche Post
//! product API (`profile=IM-PARTNER`), never from the client.

use crate::config;
use crate::postage;
use crate::store::{self, Client as TokenClient};
use crate::v1::take_tokens;
use crate::ApiError;
use axum::{
    extract::{rejection::JsonRejection, Extension, Json},
    http::StatusCode,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::Read,
    sync::{Mutex, OnceLock, PoisonError},
    time::{Duration, Instant},
};

mod client;
pub use client::*;

/// Only a local mock server (development, tests) may be reached without TLS.
pub(crate) fn is_loopback(url: &str) -> bool {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| {
            u.host_str()
                .map(|h| matches!(h, "localhost" | "127.0.0.1" | "[::1]"))
        })
        .unwrap_or(false)
        && url.starts_with("http://")
}

static CLIENT: OnceLock<Client> = OnceLock::new();

fn client() -> &'static Client {
    CLIENT.get_or_init(|| {
        let cfg = config::get();
        Client::new(Settings {
            shipping_url: cfg
                .internetmarke_shipping_url
                .trim_end_matches('/')
                .to_string(),
            products_url: cfg.internetmarke_products_url.clone(),
            client_id: cfg.internetmarke_client_id.clone().unwrap_or_default(),
            client_secret: cfg.internetmarke_client_secret.clone().unwrap_or_default(),
            require_https: !is_loopback(&cfg.internetmarke_shipping_url),
        })
    })
}

static SANDBOX_CLIENT: OnceLock<Client> = OnceLock::new();

fn sandbox_client() -> &'static Client {
    SANDBOX_CLIENT.get_or_init(|| {
        let cfg = config::get();
        let url = cfg
            .internetmarke_sandbox_shipping_url
            .clone()
            .unwrap_or_default();
        Client::new(Settings {
            require_https: !is_loopback(&url),
            shipping_url: url.trim_end_matches('/').to_string(),
            products_url: cfg
                .internetmarke_sandbox_products_url
                .clone()
                .unwrap_or_else(|| cfg.internetmarke_products_url.clone()),
            client_id: cfg
                .internetmarke_sandbox_client_id
                .clone()
                .or_else(|| cfg.internetmarke_client_id.clone())
                .unwrap_or_default(),
            client_secret: cfg
                .internetmarke_sandbox_client_secret
                .clone()
                .or_else(|| cfg.internetmarke_client_secret.clone())
                .unwrap_or_default(),
        })
    })
}

/// Which Post API a token talks to: free tokens (draft watermark) use the test API when one is configured.
struct Mode {
    client: &'static Client,
    sandbox: bool,
    /// The server supplies the Portokasse login (shared test account); the caller sends none.
    shared_login: bool,
}

fn mode_for(token: &TokenClient) -> Result<Mode, ApiError> {
    let cfg = config::get();
    if !(cfg.internetmarke_enabled
        && cfg.internetmarke_client_id.is_some()
        && cfg.internetmarke_client_secret.is_some())
    {
        return Err(error(
            StatusCode::NOT_FOUND,
            "postage_disabled",
            "buying postage stamps is not enabled on this server",
        ));
    }
    if token.kind == store::Kind::Free && cfg.internetmarke_sandbox_shipping_url.is_some() {
        let shared_login = cfg.internetmarke_sandbox_username.is_some()
            && cfg.internetmarke_sandbox_password.is_some();
        return Ok(Mode {
            client: sandbox_client(),
            sandbox: true,
            shared_login,
        });
    }
    Ok(Mode {
        client: client(),
        sandbox: false,
        shared_login: false,
    })
}

impl Mode {
    /// The login to use: the shared test login, or the caller's after a sanity check.
    fn credentials(&self, given: Option<&Credentials>) -> Result<Credentials, ApiError> {
        if self.shared_login {
            let cfg = config::get();
            return Ok(Credentials {
                username: cfg
                    .internetmarke_sandbox_username
                    .clone()
                    .unwrap_or_default(),
                password: cfg
                    .internetmarke_sandbox_password
                    .clone()
                    .unwrap_or_default(),
            });
        }
        match given {
            Some(c)
                if !c.username.trim().is_empty()
                    && !c.password.is_empty()
                    && c.username.len() <= 200
                    && c.password.len() <= 200 =>
            {
                Ok(Credentials {
                    username: c.username.clone(),
                    password: c.password.clone(),
                })
            }
            _ => Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "invalid_request",
                "credentials.username and credentials.password are required".to_string(),
            )),
        }
    }
}

/// `GET /v1/postage/products`
pub async fn list_products(
    Extension(token): Extension<TokenClient>,
) -> Result<Json<Value>, ApiError> {
    let mode = mode_for(&token)?;
    take_tokens(&token, 1).await?;
    Ok(Json(json!({
        "products": mode.client.products().await?,
        "sandbox": mode.sandbox,
        "loginRequired": !mode.shared_login,
    })))
}

fn one() -> usize {
    1
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseRequest {
    product_code: u32,
    expected_price_cents: u32,
    request_id: String,
    #[serde(default)]
    credentials: Option<Credentials>,
    #[serde(default = "one")]
    quantity: usize,
}

fn stamp_json(stamp: &Stamp) -> Value {
    let (width_mm, height_mm) = postage::dimensions_mm(&stamp.png).unwrap_or((0.0, 0.0));
    json!({
        "png": BASE64.encode(&stamp.png),
        "widthMm": width_mm,
        "heightMm": height_mm,
        "voucherId": stamp.voucher_id,
        "shopOrderId": stamp.shop_order_id,
    })
}

/// Validates the request, buys `req.quantity` stamps in one cart and returns them. Nothing is stored.
async fn purchase(
    token: &TokenClient,
    req: &PurchaseRequest,
) -> Result<(Product, Vec<Stamp>), ApiError> {
    let mode = mode_for(token)?;
    let client = mode.client;
    let credentials = mode.credentials(req.credentials.as_ref())?;
    let invalid = |details: &str| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            details.to_string(),
        )
    };
    if !(8..=64).contains(&req.request_id.len())
        || !req
            .request_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(invalid(
            "requestId must be 8 to 64 letters, digits or dashes",
        ));
    }
    if !(1..=MAX_STAMPS).contains(&req.quantity) {
        return Err(invalid(&format!(
            "quantity must be between 1 and {MAX_STAMPS}"
        )));
    }
    take_tokens(token, PURCHASE_COST + req.quantity - 1).await?;

    let started = Instant::now();
    let products = client.products().await?;
    let product = products
        .iter()
        .find(|p| p.product_code == req.product_code)
        .ok_or_else(|| {
            error(
                StatusCode::BAD_REQUEST,
                "postage_unknown_product",
                "this product is not available",
            )
        })?;
    if product.price_cents != req.expected_price_cents {
        crate::metrics::postage_stamp("price_changed");
        return Err(error(
            StatusCode::CONFLICT,
            "postage_price_changed",
            format!(
                "the price is now {} cent; reload the product list",
                product.price_cents
            ),
        ));
    }

    // One purchase per browser click: a repeated request id is refused (hash only, no data).
    let marker = format!(
        "pdfcraft:postage:{}",
        store::hash_secret(&format!("{}:{}", token.id, req.request_id))
    );
    match store::mark_once(&marker, REQUEST_MARKER_TTL_SECS).await {
        Ok(true) => {}
        Ok(false) => {
            return Err(error(
                StatusCode::CONFLICT,
                "postage_duplicate",
                "this purchase request was already processed",
            ))
        }
        Err(_) => {
            return Err(error(
                StatusCode::SERVICE_UNAVAILABLE,
                "store_unavailable",
                "the token store (Valkey) is not reachable",
            ))
        }
    }

    let result = client.buy(product, req.quantity, &credentials).await;
    let outcome = match &result {
        Ok(_) => "bought",
        Err(e) => e.code,
    };
    crate::metrics::postage_stamp(outcome);
    tracing::info!(
        event = "postage_purchase",
        outcome,
        product_code = product.product_code,
        price_cents = product.price_cents,
        quantity = req.quantity,
        token_id = %token.id,
        duration_ms = started.elapsed().as_secs_f64() * 1000.0,
    );
    Ok((product.clone(), result?))
}

fn bad_body(e: JsonRejection) -> ApiError {
    ApiError::new(
        e.status(),
        "invalid_request",
        "the request body is not valid",
    )
}

/// `POST /v1/postage/stamps`: buys one stamp and returns the PNG.
pub async fn buy_stamp(
    Extension(token): Extension<TokenClient>,
    payload: Result<Json<PurchaseRequest>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let sandbox = mode_for(&token)?.sandbox;
    let Json(req) = payload.map_err(bad_body)?;
    if req.quantity != 1 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "use /v1/postage/stamps/bulk for several stamps".to_string(),
        ));
    }
    let (product, stamps) = purchase(&token, &req).await?;
    let stamp = &stamps[0];
    let mut out = stamp_json(stamp);
    out["productCode"] = json!(product.product_code);
    out["productName"] = json!(product.name);
    out["priceCents"] = json!(product.price_cents);
    out["walletBalanceCents"] = json!(stamp.wallet_balance_cents);
    out["sandbox"] = json!(sandbox);
    Ok(Json(out))
}

/// `POST /v1/postage/stamps/bulk`: buys `quantity` stamps in one cart (all or nothing, one login).
pub async fn buy_stamps_bulk(
    Extension(token): Extension<TokenClient>,
    payload: Result<Json<PurchaseRequest>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let sandbox = mode_for(&token)?.sandbox;
    let Json(req) = payload.map_err(bad_body)?;
    let (product, stamps) = purchase(&token, &req).await?;
    Ok(Json(json!({
        "sandbox": sandbox,
        "stamps": stamps.iter().map(stamp_json).collect::<Vec<_>>(),
        "productCode": product.product_code,
        "productName": product.name,
        "priceCents": product.price_cents,
        "totalCents": u64::from(product.price_cents) * stamps.len() as u64,
        "walletBalanceCents": stamps[0].wallet_balance_cents,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverRequest {
    shop_order_id: String,
    #[serde(default)]
    credentials: Option<Credentials>,
}

/// `POST /v1/postage/stamps/recover`: downloads the stamps of an order that was paid but not delivered
/// (`postage_download_failed`) again. Buys nothing; nothing is stored.
pub async fn recover_stamps(
    Extension(token): Extension<TokenClient>,
    payload: Result<Json<RecoverRequest>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let mode = mode_for(&token)?;
    let Json(req) = payload.map_err(bad_body)?;
    let credentials = mode.credentials(req.credentials.as_ref())?;
    let invalid = |details: &str| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            details.to_string(),
        )
    };
    let id = &req.shop_order_id;
    if !(1..=18).contains(&id.len()) || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(invalid(
            "shopOrderId must be 1 to 18 letters, digits or dashes",
        ));
    }
    take_tokens(&token, RECOVER_COST).await?;
    let result = mode.client.recover(id, &credentials).await;
    crate::metrics::postage_stamp(match &result {
        Ok(_) => "recovered",
        Err(e) => e.code,
    });
    let stamps = result?;
    Ok(Json(
        json!({ "stamps": stamps.iter().map(stamp_json).collect::<Vec<_>>(), "sandbox": mode.sandbox }),
    ))
}

#[cfg(test)]
mod tests;
