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
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

pub const DEFAULT_SHIPPING_URL: &str = "https://api-eu.dhl.com/post/de/shipping/im/v1";
pub const DEFAULT_PRODUCTS_URL: &str =
    "https://api-eu.dhl.com/post/de/information/products/v1/products?profile=IM-PARTNER&shortVersion=true";

const PRODUCT_CACHE: Duration = Duration::from_secs(3600);
const MAX_DOWNLOAD_BYTES: usize = 2 * 1024 * 1024;
const DOWNLOAD_ATTEMPTS: u32 = 3;
const REQUEST_MARKER_TTL_SECS: u64 = 900;
/// A purchase also costs rate-limit tokens: it is a login oracle for the Portokasse otherwise.
const PURCHASE_COST: usize = 5;
/// Rate-limit tokens for fetching a paid order again.
const RECOVER_COST: usize = 2;
/// Stamps per bulk purchase (one cart; keeps the response well below any size limit).
pub const MAX_STAMPS: usize = 25;
const LETTERS: &[&str] = &["standardbrief", "kompaktbrief", "großbrief", "grossbrief", "maxibrief"];
const EXCLUDED: &[&str] = &[
    "einschreiben", "einwurf", "rückschein", "rueckschein", "eigenhändig", "eigenhaendig", "nachnahme", "prio",
    "dialog", "info", "international", "ausland", "plus",
];

pub struct Settings {
    pub shipping_url: String,
    pub products_url: String,
    pub client_id: String,
    pub client_secret: String,
    /// The stamp download link must use https (switched off only for tests against a local server).
    pub require_https: bool,
}

/// Portokasse login of the user. Deliberately without `Debug`/`Clone`/`Serialize`.
#[derive(Deserialize)]
pub struct Credentials {
    username: String,
    password: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub product_code: u32,
    pub name: String,
    pub price_cents: u32,
}

pub struct Stamp {
    pub png: Vec<u8>,
    pub voucher_id: String,
    pub shop_order_id: String,
    pub wallet_balance_cents: Option<i64>,
}

pub struct Client {
    http: reqwest::Client,
    settings: Settings,
    products: Mutex<Option<(Instant, Vec<Product>)>>,
}

fn error(status: StatusCode, code: &'static str, details: impl Into<String>) -> ApiError {
    ApiError::new(status, code, details)
}

fn unreachable_upstream(e: &reqwest::Error) -> ApiError {
    let reason = if e.is_timeout() { "timeout" } else if e.is_connect() { "connection failed" } else { "request failed" };
    tracing::warn!(event = "postage_upstream", reason);
    error(StatusCode::BAD_GATEWAY, "postage_upstream_error", format!("Deutsche Post is not reachable ({reason})"))
}

fn upstream(details: impl Into<String>) -> ApiError {
    error(StatusCode::BAD_GATEWAY, "postage_upstream_error", details)
}

fn num(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str().and_then(|s| s.trim().replace(',', ".").parse().ok()))
}

/// Letter products only: no registered mail, no international, no add-on services.
fn letter(name: &str) -> bool {
    let name = name.trim().to_lowercase();
    LETTERS.iter().any(|l| name == *l || name.starts_with(&format!("{l} "))) && !EXCLUDED.iter().any(|x| name.contains(x))
}

fn parse_products(body: &Value) -> Vec<Product> {
    let mut products: Vec<Product> = body["shortSalesProducts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| {
            let code = u32::try_from(num(&p["extProductid"])? as i64).ok().filter(|c| *c > 0)?;
            let name = p["extProductname"].as_str()?.trim().to_string();
            let price = (num(&p["grossprice"])? * 100.0).round();
            let national = p["transport"].as_str().is_none_or(|t| t.eq_ignore_ascii_case("national"));
            (letter(&name) && national && price > 0.0 && price < 100_000.0).then_some(Product {
                product_code: code,
                name,
                price_cents: price as u32,
            })
        })
        .collect();
    products.sort_by_key(|p| (p.price_cents, p.product_code));
    products.dedup_by_key(|p| p.product_code);
    products
}

/// Short, safe text from an error body of Deutsche Post (never anything we sent).
fn upstream_message(body: &Value) -> String {
    ["detail", "title", "message", "error_description"]
        .iter()
        .find_map(|k| body[k].as_str())
        .map(|m| m.chars().filter(|c| !c.is_control()).take(200).collect())
        .unwrap_or_else(|| "request rejected".into())
}

/// File number in a name like `3.png` or `stamps/3.png` (for ordering; unnumbered names sort last).
fn file_number(name: &str) -> (u64, String) {
    let stem = name.rsplit('/').next().unwrap_or(name).trim_end_matches(".png").trim_end_matches(".PNG");
    (stem.parse().unwrap_or(u64::MAX), name.to_string())
}

/// PNG images of a download that is either a bare PNG or a ZIP of PNGs (in file number order).
fn extract_pngs(data: &[u8]) -> Option<Vec<Vec<u8>>> {
    const SIGNATURE: &[u8] = &[0x89, b'P', b'N', b'G'];
    if data.starts_with(SIGNATURE) {
        return Some(vec![data.to_vec()]);
    }
    if !data.starts_with(b"PK") {
        return None;
    }
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data)).ok()?;
    let mut names: Vec<String> = archive
        .file_names()
        .filter_map(|n| n.ok())
        .filter(|n| n.to_lowercase().ends_with(".png"))
        .map(|n| n.into_owned())
        .collect();
    names.sort_by_key(|n| file_number(n));
    let mut pngs = Vec::new();
    let mut total = 0;
    for name in &names {
        let mut png = Vec::new();
        archive.by_name(name).ok()?.take(MAX_DOWNLOAD_BYTES as u64).read_to_end(&mut png).ok()?;
        total += png.len();
        if !png.starts_with(SIGNATURE) || total > MAX_DOWNLOAD_BYTES {
            return None;
        }
        pngs.push(png);
    }
    (!pngs.is_empty()).then_some(pngs)
}

impl Client {
    pub fn new(settings: Settings) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(concat!("pdfcraft/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP client");
        Self { http, settings, products: Mutex::new(None) }
    }

    pub async fn products(&self) -> Result<Vec<Product>, ApiError> {
        if let Some((at, list)) = &*self.products.lock().unwrap() {
            if at.elapsed() < PRODUCT_CACHE {
                return Ok(list.clone());
            }
        }
        let response = self
            .http
            .get(&self.settings.products_url)
            .header("dhl-api-key", &self.settings.client_id)
            .send()
            .await
            .map_err(|e| unreachable_upstream(&e))?;
        let status = response.status();
        let body: Value = response.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            return Err(upstream(format!("product list unavailable ({status}): {}", upstream_message(&body))));
        }
        let list = parse_products(&body);
        if list.is_empty() {
            tracing::warn!(event = "postage_no_products", raw = body["shortSalesProducts"].as_array().map_or(0, Vec::len));
        }
        *self.products.lock().unwrap() = Some((Instant::now(), list.clone()));
        Ok(list)
    }

    /// Access token and wallet balance (euro cent) of the Portokasse account.
    async fn login(&self, creds: &Credentials) -> Result<(String, Option<i64>), ApiError> {
        let response = self
            .http
            .post(format!("{}/user", self.settings.shipping_url))
            .form(&[
                ("grant_type", "client_credentials"),
                ("client_id", self.settings.client_id.as_str()),
                ("client_secret", self.settings.client_secret.as_str()),
                ("username", creds.username.as_str()),
                ("password", creds.password.as_str()),
            ])
            .send()
            .await
            .map_err(|e| unreachable_upstream(&e))?;
        let status = response.status();
        let body: Value = response.json().await.unwrap_or(Value::Null);
        if matches!(status.as_u16(), 400 | 401 | 403) {
            return Err(error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "postage_login_failed",
                "the Portokasse login was rejected (check e-mail and password)",
            ));
        }
        let Some(token) = body["access_token"].as_str().filter(|_| status.is_success()) else {
            return Err(upstream(format!("login failed ({status})")));
        };
        let wallet = num(&body["walletBalance"]).or_else(|| num(&body["walletBallance"])).map(|v| v as i64);
        Ok((token.to_string(), wallet))
    }

    async fn post_json(&self, token: &str, path: &str, body: &Value) -> Result<Value, ApiError> {
        let response = self
            .http
            .post(format!("{}{path}", self.settings.shipping_url))
            .bearer_auth(token)
            .header("dhl-api-key", &self.settings.client_id)
            .json(body)
            .send()
            .await
            .map_err(|e| unreachable_upstream(&e))?;
        let status = response.status();
        let body: Value = response.json().await.unwrap_or(Value::Null);
        if status.is_success() {
            return Ok(body);
        }
        if body.to_string().to_lowercase().contains("walletbalancenotenough") {
            return Err(error(StatusCode::PAYMENT_REQUIRED, "postage_wallet_insufficient", "the Portokasse balance is too low"));
        }
        Err(upstream(format!("{path} rejected ({status}): {}", upstream_message(&body))))
    }

    async fn download(&self, link: &str) -> Result<Vec<Vec<u8>>, ApiError> {
        let url = reqwest::Url::parse(link).map_err(|_| upstream("the stamp link is invalid"))?;
        if (self.settings.require_https && (url.scheme() != "https" || url.domain().is_none())) || url.username() != "" {
            return Err(upstream("the stamp link is not an https link"));
        }
        // No Authorization header: the link may point to another host than the API.
        let mut response = self.http.get(url).send().await.map_err(|e| unreachable_upstream(&e))?;
        if !response.status().is_success() {
            return Err(upstream(format!("stamp download failed ({})", response.status())));
        }
        let mut data = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| unreachable_upstream(&e))? {
            data.extend_from_slice(&chunk);
            if data.len() > MAX_DOWNLOAD_BYTES {
                return Err(upstream("the stamp download is too large"));
            }
        }
        extract_pngs(&data).ok_or_else(|| upstream("the stamp download is not a PNG"))
    }

    /// Buys `count` franking marks of `product` in one cart (all or nothing) from the Portokasse of `creds`.
    pub async fn buy(&self, product: &Product, count: usize, creds: &Credentials) -> Result<Vec<Stamp>, ApiError> {
        let total = i64::from(product.price_cents) * count as i64;
        let (token, wallet) = self.login(creds).await?;
        if wallet.is_some_and(|w| w < total) {
            return Err(error(StatusCode::PAYMENT_REQUIRED, "postage_wallet_insufficient", "the Portokasse balance is too low"));
        }
        let cart = self.post_json(&token, "/app/shoppingcart", &json!({})).await?;
        let shop_order_id = cart["shopOrderId"].as_str().ok_or_else(|| upstream("no shopOrderId in the cart response"))?.to_string();
        let body = json!({
            "type": "AppShoppingCartPNGRequest",
            "shopOrderId": shop_order_id,
            "total": total,
            "createManifest": false,
            "dpi": "DPI300",
            "optimizePNG": true,
            "positions": (0..count).map(|_| json!({
                "productCode": product.product_code,
                "voucherLayout": "FRANKING_ZONE",
                "positionType": "AppShoppingCartPosition",
            })).collect::<Vec<_>>(),
        });
        let checkout = self.post_json(&token, "/app/shoppingcart/png?directCheckout=true", &body).await?;
        let voucher_ids: Vec<String> = (0..count)
            .map(|i| checkout["shoppingCart"]["voucherList"][i]["voucherId"].as_str().unwrap_or_default().to_string())
            .collect();
        let wallet_balance_cents = num(&checkout["walletBalance"]).or_else(|| num(&checkout["walletBallance"])).map(|v| v as i64);
        let Some(link) = checkout["link"].as_str() else { return Err(lost_download(&shop_order_id, "no download link")) };
        self.fetch_stamps(link, &voucher_ids, &shop_order_id, wallet_balance_cents).await
    }

    /// Downloads the images of a paid order and pairs them with the voucher ids. From here on the
    /// stamps are paid, so a failure must say so and name the order.
    async fn fetch_stamps(&self, link: &str, voucher_ids: &[String], shop_order_id: &str, wallet_balance_cents: Option<i64>) -> Result<Vec<Stamp>, ApiError> {
        let count = voucher_ids.len();
        let mut last = None;
        for attempt in 0..DOWNLOAD_ATTEMPTS {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            match self.download(link).await {
                Ok(pngs) if pngs.len() == count => {
                    return Ok(pngs
                        .into_iter()
                        .zip(voucher_ids.iter())
                        .map(|(png, voucher_id)| Stamp {
                            png,
                            voucher_id: voucher_id.clone(),
                            shop_order_id: shop_order_id.to_string(),
                            wallet_balance_cents,
                        })
                        .collect());
                }
                Ok(pngs) => last = Some(format!("expected {count} images, got {}", pngs.len())),
                Err(e) => last = Some(e.details),
            }
        }
        Err(lost_download(shop_order_id, last.as_deref().unwrap_or("unknown error")))
    }

    /// Fetches the stamps of an already paid order again (`GET /app/shoppingcart/{shopOrderId}`), e.g. after
    /// `postage_download_failed`. Costs no postage.
    pub async fn recover(&self, shop_order_id: &str, creds: &Credentials) -> Result<Vec<Stamp>, ApiError> {
        let (token, wallet) = self.login(creds).await?;
        let response = self
            .http
            .get(format!("{}/app/shoppingcart/{shop_order_id}", self.settings.shipping_url))
            .bearer_auth(&token)
            .header("dhl-api-key", &self.settings.client_id)
            .send()
            .await
            .map_err(|e| unreachable_upstream(&e))?;
        let status = response.status();
        let body: Value = response.json().await.unwrap_or(Value::Null);
        if matches!(status.as_u16(), 400 | 404) {
            return Err(error(StatusCode::NOT_FOUND, "postage_order_not_found", "this order does not exist in the Portokasse of this login"));
        }
        if !status.is_success() {
            return Err(upstream(format!("order lookup rejected ({status}): {}", upstream_message(&body))));
        }
        let voucher_ids: Vec<String> = body["shoppingCart"]["voucherList"]
            .as_array()
            .map(|list| list.iter().filter_map(|v| v["voucherId"].as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        let link = body["link"].as_str().filter(|_| !voucher_ids.is_empty());
        let Some(link) = link else { return Err(lost_download(shop_order_id, "the order has no stamps or no download link")) };
        self.fetch_stamps(link, &voucher_ids, shop_order_id, wallet).await
    }
}

fn lost_download(shop_order_id: &str, why: &str) -> ApiError {
    error(
        StatusCode::BAD_GATEWAY,
        "postage_download_failed",
        format!("the stamps were bought but could not be downloaded ({why}); find order {shop_order_id} in your Portokasse"),
    )
}

/// Only a local mock server (development, tests) may be reached without TLS.
pub(crate) fn is_loopback(url: &str) -> bool {
    reqwest::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| matches!(h, "localhost" | "127.0.0.1" | "[::1]"))).unwrap_or(false)
        && url.starts_with("http://")
}

static CLIENT: OnceLock<Client> = OnceLock::new();

fn client() -> &'static Client {
    CLIENT.get_or_init(|| {
        let cfg = config::get();
        Client::new(Settings {
            shipping_url: cfg.internetmarke_shipping_url.trim_end_matches('/').to_string(),
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
        let url = cfg.internetmarke_sandbox_shipping_url.clone().unwrap_or_default();
        Client::new(Settings {
            require_https: !is_loopback(&url),
            shipping_url: url.trim_end_matches('/').to_string(),
            products_url: cfg.internetmarke_sandbox_products_url.clone().unwrap_or_else(|| cfg.internetmarke_products_url.clone()),
            client_id: cfg.internetmarke_sandbox_client_id.clone().or_else(|| cfg.internetmarke_client_id.clone()).unwrap_or_default(),
            client_secret: cfg.internetmarke_sandbox_client_secret.clone().or_else(|| cfg.internetmarke_client_secret.clone()).unwrap_or_default(),
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
    if !(cfg.internetmarke_enabled && cfg.internetmarke_client_id.is_some() && cfg.internetmarke_client_secret.is_some()) {
        return Err(error(StatusCode::NOT_FOUND, "postage_disabled", "buying postage stamps is not enabled on this server"));
    }
    if token.kind == store::Kind::Free && cfg.internetmarke_sandbox_shipping_url.is_some() {
        let shared_login = cfg.internetmarke_sandbox_username.is_some() && cfg.internetmarke_sandbox_password.is_some();
        return Ok(Mode { client: sandbox_client(), sandbox: true, shared_login });
    }
    Ok(Mode { client: client(), sandbox: false, shared_login: false })
}

impl Mode {
    /// The login to use: the shared test login, or the caller's after a sanity check.
    fn credentials(&self, given: Option<&Credentials>) -> Result<Credentials, ApiError> {
        if self.shared_login {
            let cfg = config::get();
            return Ok(Credentials {
                username: cfg.internetmarke_sandbox_username.clone().unwrap_or_default(),
                password: cfg.internetmarke_sandbox_password.clone().unwrap_or_default(),
            });
        }
        match given {
            Some(c) if !c.username.trim().is_empty() && !c.password.is_empty() && c.username.len() <= 200 && c.password.len() <= 200 => {
                Ok(Credentials { username: c.username.clone(), password: c.password.clone() })
            }
            _ => Err(ApiError::new(StatusCode::BAD_REQUEST, "invalid_request", "credentials.username and credentials.password are required".to_string())),
        }
    }
}

/// `GET /v1/postage/products`
pub async fn list_products(Extension(token): Extension<TokenClient>) -> Result<Json<Value>, ApiError> {
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
async fn purchase(token: &TokenClient, req: &PurchaseRequest) -> Result<(Product, Vec<Stamp>), ApiError> {
    let mode = mode_for(token)?;
    let client = mode.client;
    let credentials = mode.credentials(req.credentials.as_ref())?;
    let invalid = |details: &str| ApiError::new(StatusCode::BAD_REQUEST, "invalid_request", details.to_string());
    if !(8..=64).contains(&req.request_id.len()) || !req.request_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(invalid("requestId must be 8 to 64 letters, digits or dashes"));
    }
    if !(1..=MAX_STAMPS).contains(&req.quantity) {
        return Err(invalid(&format!("quantity must be between 1 and {MAX_STAMPS}")));
    }
    take_tokens(token, PURCHASE_COST + req.quantity - 1).await?;

    let started = Instant::now();
    let products = client.products().await?;
    let product = products
        .iter()
        .find(|p| p.product_code == req.product_code)
        .ok_or_else(|| error(StatusCode::BAD_REQUEST, "postage_unknown_product", "this product is not available"))?;
    if product.price_cents != req.expected_price_cents {
        crate::metrics::postage_stamp("price_changed");
        return Err(error(
            StatusCode::CONFLICT,
            "postage_price_changed",
            format!("the price is now {} cent; reload the product list", product.price_cents),
        ));
    }

    // One purchase per browser click: a repeated request id is refused (hash only, no data).
    let marker = format!("pdfcraft:postage:{}", store::hash_secret(&format!("{}:{}", token.id, req.request_id)));
    match store::mark_once(&marker, REQUEST_MARKER_TTL_SECS).await {
        Ok(true) => {}
        Ok(false) => return Err(error(StatusCode::CONFLICT, "postage_duplicate", "this purchase request was already processed")),
        Err(_) => return Err(error(StatusCode::SERVICE_UNAVAILABLE, "store_unavailable", "the token store (Valkey) is not reachable")),
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
    ApiError::new(e.status(), "invalid_request", "the request body is not valid")
}

/// `POST /v1/postage/stamps`: buys one stamp and returns the PNG.
pub async fn buy_stamp(
    Extension(token): Extension<TokenClient>,
    payload: Result<Json<PurchaseRequest>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let sandbox = mode_for(&token)?.sandbox;
    let Json(req) = payload.map_err(bad_body)?;
    if req.quantity != 1 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "invalid_request", "use /v1/postage/stamps/bulk for several stamps".to_string()));
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
    let invalid = |details: &str| ApiError::new(StatusCode::BAD_REQUEST, "invalid_request", details.to_string());
    let id = &req.shop_order_id;
    if !(1..=18).contains(&id.len()) || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(invalid("shopOrderId must be 1 to 18 letters, digits or dashes"));
    }
    take_tokens(&token, RECOVER_COST).await?;
    let result = mode.client.recover(id, &credentials).await;
    crate::metrics::postage_stamp(match &result {
        Ok(_) => "recovered",
        Err(e) => e.code,
    });
    let stamps = result?;
    Ok(Json(json!({ "stamps": stamps.iter().map(stamp_json).collect::<Vec<_>>(), "sandbox": mode.sandbox })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::State, routing::{get, post}, Router};
    use std::sync::Arc;

    fn zipped(pngs: &[Vec<u8>]) -> Vec<u8> {
        use std::io::Write;
        let mut out = std::io::Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(&mut out);
        // Written in reverse to prove that the file number decides the order.
        for (i, png) in pngs.iter().enumerate().rev() {
            zip.start_file(format!("{i}.png"), zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored)).unwrap();
            zip.write_all(png).unwrap();
        }
        zip.finish().unwrap();
        out.into_inner()
    }

    #[test]
    fn keeps_only_national_letter_products() {
        let body = json!({"shortSalesProducts": [
            {"extProductid": "11", "extProductname": "Kompaktbrief", "grossprice": 1.6, "transport": "national"},
            {"extProductid": 1, "extProductname": "Standardbrief", "grossprice": "0,95", "transport": "national"},
            {"extProductid": 5, "extProductname": "Einschreiben Einwurf", "grossprice": 3.35, "transport": "national"},
            {"extProductid": 9, "extProductname": "Kompaktbrief International", "grossprice": 3.0, "transport": "international"},
            {"extProductid": 21, "extProductname": "Großbrief", "grossprice": 1.8},
            {"extProductid": 77, "extProductname": "Paket", "grossprice": 6.0},
        ]});
        let list = parse_products(&body);
        let summary: Vec<_> = list.iter().map(|p| (p.product_code, p.price_cents)).collect();
        assert_eq!(summary, vec![(1, 95), (11, 160), (21, 180)]);
    }

    #[test]
    fn extracts_a_png_from_a_zip_or_a_bare_png() {
        let png = postage::test_png(40, 20, None);
        assert_eq!(extract_pngs(&png).unwrap(), vec![png.clone()]);
        assert_eq!(extract_pngs(&zipped(std::slice::from_ref(&png))).unwrap(), vec![png]);
        assert!(extract_pngs(b"<html>").is_none());
    }

    #[test]
    fn orders_zip_images_by_file_number() {
        let pngs: Vec<Vec<u8>> = (1..=12).map(|i| postage::test_png(10 * i, 20, None)).collect();
        assert_eq!(extract_pngs(&zipped(&pngs)).unwrap(), pngs);
    }

    #[derive(Clone)]
    struct Mock {
        pngs: Arc<Vec<Vec<u8>>>,
        wallet: i64,
        seen_password: Arc<Mutex<Option<String>>>,
    }

    async fn serve(mock: Mock) -> String {
        async fn user(State(m): State<Mock>, body: String) -> Json<Value> {
            let password = body.split('&').find_map(|p| p.strip_prefix("password=")).map(String::from);
            *m.seen_password.lock().unwrap() = password;
            Json(json!({"access_token": "tok", "walletBalance": m.wallet}))
        }
        async fn cart() -> Json<Value> {
            Json(json!({"shopOrderId": "4711"}))
        }
        async fn png(State(_): State<Mock>, headers: axum::http::HeaderMap, Json(body): Json<Value>) -> Result<Json<Value>, StatusCode> {
            assert_eq!(headers["authorization"], "Bearer tok");
            let count = body["positions"].as_array().unwrap().len();
            assert_eq!(body["total"], 160 * count);
            assert_eq!(body["positions"][0]["voucherLayout"], "FRANKING_ZONE");
            Ok(Json(json!({
                "link": format!("http://{}/download/0.zip", headers["host"].to_str().unwrap()),
                "shoppingCart": {"voucherList": (1..=count).map(|i| json!({"voucherId": format!("A000{i}")})).collect::<Vec<_>>()},
                "walletBallance": 1000 - 160 * count,
            })))
        }
        async fn download(State(m): State<Mock>, headers: axum::http::HeaderMap) -> Vec<u8> {
            assert!(headers.get("authorization").is_none());
            zipped(&m.pngs)
        }
        async fn order(headers: axum::http::HeaderMap, axum::extract::Path(id): axum::extract::Path<String>) -> Result<Json<Value>, StatusCode> {
            if id != "4711" {
                return Err(StatusCode::NOT_FOUND);
            }
            Ok(Json(json!({
                "link": format!("http://{}/download/0.zip", headers["host"].to_str().unwrap()),
                "shoppingCart": {"shopOrderId": id, "voucherList": [{"voucherId": "A0001"}, {"voucherId": "A0002"}]},
            })))
        }
        let app = Router::new()
            .route("/app/shoppingcart/{id}", get(order))
            .route("/user", post(user))
            .route("/app/shoppingcart", post(cart))
            .route("/app/shoppingcart/png", post(png))
            .route("/download/0.zip", get(download))
            .with_state(mock);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    fn client_for(base: &str) -> Client {
        Client::new(Settings {
            shipping_url: base.to_string(),
            products_url: format!("{base}/products"),
            client_id: "id".into(),
            client_secret: "secret".into(),
            require_https: false,
        })
    }

    fn creds() -> Credentials {
        Credentials { username: "me@example.com".into(), password: "pw".into() }
    }

    fn product() -> Product {
        Product { product_code: 11, name: "Kompaktbrief".into(), price_cents: 160 }
    }

    #[tokio::test]
    async fn buys_a_stamp_and_downloads_it_without_credentials() {
        let png = postage::test_png(472, 283, None);
        let mock = Mock { pngs: Arc::new(vec![png.clone()]), wallet: 1000, seen_password: Default::default() };
        let base = serve(mock.clone()).await;
        let stamps = client_for(&base).buy(&product(), 1, &creds()).await.ok().expect("purchase");
        let stamp = &stamps[0];
        assert_eq!(stamp.png, png);
        assert_eq!((stamp.voucher_id.as_str(), stamp.shop_order_id.as_str()), ("A0001", "4711"));
        assert_eq!(stamp.wallet_balance_cents, Some(840));
        assert_eq!(mock.seen_password.lock().unwrap().as_deref(), Some("pw"));
    }

    #[tokio::test]
    async fn buys_several_stamps_in_one_cart_and_pairs_them_with_voucher_ids() {
        let pngs: Vec<Vec<u8>> = (1..=3).map(|i| postage::test_png(400 + i * 10, 283, None)).collect();
        let mock = Mock { pngs: Arc::new(pngs.clone()), wallet: 1000, seen_password: Default::default() };
        let base = serve(mock).await;
        let stamps = client_for(&base).buy(&product(), 3, &creds()).await.ok().expect("purchase");
        assert_eq!(stamps.iter().map(|s| s.png.clone()).collect::<Vec<_>>(), pngs);
        assert_eq!(stamps.iter().map(|s| s.voucher_id.as_str()).collect::<Vec<_>>(), vec!["A0001", "A0002", "A0003"]);
        assert_eq!(stamps[0].wallet_balance_cents, Some(520));
    }

    #[tokio::test]
    async fn reports_a_paid_purchase_when_the_image_count_is_wrong() {
        let png = postage::test_png(40, 20, None);
        let mock = Mock { pngs: Arc::new(vec![png]), wallet: 1000, seen_password: Default::default() };
        let base = serve(mock).await;
        let Err(err) = client_for(&base).buy(&product(), 2, &creds()).await else { panic!("must fail") };
        assert_eq!(err.code, "postage_download_failed");
        assert!(err.details.contains("4711"));
    }

    #[tokio::test]
    async fn refuses_before_buying_when_the_wallet_covers_only_part_of_the_total() {
        let mock = Mock { pngs: Arc::new(Vec::new()), wallet: 300, seen_password: Default::default() };
        let base = serve(mock).await;
        let Err(err) = client_for(&base).buy(&product(), 2, &creds()).await else { panic!("must fail") };
        assert_eq!(err.code, "postage_wallet_insufficient");
    }

    #[tokio::test]
    async fn fetches_a_paid_order_again_without_buying() {
        let pngs: Vec<Vec<u8>> = (1..=2).map(|i| postage::test_png(400 + i * 10, 283, None)).collect();
        let mock = Mock { pngs: Arc::new(pngs.clone()), wallet: 1000, seen_password: Default::default() };
        let base = serve(mock).await;
        let stamps = client_for(&base).recover("4711", &creds()).await.ok().expect("recover");
        assert_eq!(stamps.iter().map(|s| s.png.clone()).collect::<Vec<_>>(), pngs);
        assert_eq!(stamps.iter().map(|s| s.voucher_id.as_str()).collect::<Vec<_>>(), vec!["A0001", "A0002"]);
        assert!(stamps.iter().all(|s| s.shop_order_id == "4711"));

        let Err(err) = client_for(&base).recover("999", &creds()).await else { panic!("must fail") };
        assert_eq!((err.code, err.status), ("postage_order_not_found", StatusCode::NOT_FOUND));
    }

    #[test]
    fn a_caller_login_is_required_without_a_shared_test_login() {
        let mode = Mode { client: Box::leak(Box::new(client_for("http://127.0.0.1:1"))), sandbox: false, shared_login: false };
        assert!(mode.credentials(None).is_err());
        assert!(mode.credentials(Some(&Credentials { username: " ".into(), password: "pw".into() })).is_err());
        assert!(mode.credentials(Some(&Credentials { username: "a@b.de".into(), password: String::new() })).is_err());
        assert_eq!(mode.credentials(Some(&creds())).ok().expect("valid").username, "me@example.com");
    }

    #[test]
    fn only_local_http_servers_skip_tls() {
        assert!(is_loopback("http://127.0.0.1:9000/im/v1"));
        assert!(is_loopback("http://localhost:9000"));
        assert!(!is_loopback("http://example.com"));
        assert!(!is_loopback("https://127.0.0.1"));
        assert!(!is_loopback("https://api-eu.dhl.com/post/de/shipping/im/v1"));
    }

    #[tokio::test]
    async fn refuses_before_buying_when_the_wallet_is_too_low() {
        let mock = Mock { pngs: Arc::new(Vec::new()), wallet: 100, seen_password: Default::default() };
        let base = serve(mock).await;
        let Err(err) = client_for(&base).buy(&product(), 1, &creds()).await else { panic!("must fail") };
        assert_eq!(err.code, "postage_wallet_insufficient");
    }

    #[tokio::test]
    async fn refuses_non_https_download_links_by_default() {
        let mut client = client_for("http://127.0.0.1:1");
        client.settings.require_https = true;
        assert!(client.download("http://example.com/0.png").await.is_err());
        assert!(client.download("https://user:pw@example.com/0.png").await.is_err());
    }
}
