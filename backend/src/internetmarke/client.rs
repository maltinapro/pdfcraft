use super::*;

pub const DEFAULT_SHIPPING_URL: &str = "https://api-eu.dhl.com/post/de/shipping/im/v1";
pub const DEFAULT_PRODUCTS_URL: &str =
    "https://api-eu.dhl.com/post/de/information/products/v1/products?profile=IM-PARTNER&shortVersion=true";

pub(super) const PRODUCT_CACHE: Duration = Duration::from_secs(3600);
pub(super) const MAX_DOWNLOAD_BYTES: usize = 2 * 1024 * 1024;
pub(super) const DOWNLOAD_ATTEMPTS: u32 = 3;
pub(super) const REQUEST_MARKER_TTL_SECS: u64 = 900;
/// A purchase also costs rate-limit tokens: it is a login oracle for the Portokasse otherwise.
pub(super) const PURCHASE_COST: usize = 5;
/// Rate-limit tokens for fetching a paid order again.
pub(super) const RECOVER_COST: usize = 2;
/// Stamps per bulk purchase (one cart; keeps the response well below any size limit).
pub const MAX_STAMPS: usize = 25;
pub(super) const LETTERS: &[&str] = &[
    "standardbrief",
    "kompaktbrief",
    "großbrief",
    "grossbrief",
    "maxibrief",
];
pub(super) const EXCLUDED: &[&str] = &[
    "einschreiben",
    "einwurf",
    "rückschein",
    "rueckschein",
    "eigenhändig",
    "eigenhaendig",
    "nachnahme",
    "prio",
    "dialog",
    "info",
    "international",
    "ausland",
    "plus",
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
    pub(super) username: String,
    pub(super) password: String,
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
    pub(super) settings: Settings,
    products: Mutex<Option<(Instant, Vec<Product>)>>,
}

pub(super) fn error(
    status: StatusCode,
    code: &'static str,
    details: impl Into<String>,
) -> ApiError {
    ApiError::new(status, code, details)
}

pub(super) fn unreachable_upstream(e: &reqwest::Error) -> ApiError {
    let reason = if e.is_timeout() {
        "timeout"
    } else if e.is_connect() {
        "connection failed"
    } else {
        "request failed"
    };
    tracing::warn!(event = "postage_upstream", reason);
    error(
        StatusCode::BAD_GATEWAY,
        "postage_upstream_error",
        format!("Deutsche Post is not reachable ({reason})"),
    )
}

pub(super) fn upstream(details: impl Into<String>) -> ApiError {
    error(StatusCode::BAD_GATEWAY, "postage_upstream_error", details)
}

pub(super) fn num(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| {
        value
            .as_str()
            .and_then(|s| s.trim().replace(',', ".").parse().ok())
    })
}

/// Letter products only: no registered mail, no international, no add-on services.
pub(super) fn letter(name: &str) -> bool {
    let name = name.trim().to_lowercase();
    LETTERS
        .iter()
        .any(|l| name == *l || name.starts_with(&format!("{l} ")))
        && !EXCLUDED.iter().any(|x| name.contains(x))
}

pub(super) fn parse_products(body: &Value) -> Vec<Product> {
    let mut products: Vec<Product> = body["shortSalesProducts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| {
            let code = u32::try_from(num(&p["extProductid"])? as i64)
                .ok()
                .filter(|c| *c > 0)?;
            let name = p["extProductname"].as_str()?.trim().to_string();
            let price = (num(&p["grossprice"])? * 100.0).round();
            let national = p["transport"]
                .as_str()
                .is_none_or(|t| t.eq_ignore_ascii_case("national"));
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
pub(super) fn upstream_message(body: &Value) -> String {
    ["detail", "title", "message", "error_description"]
        .iter()
        .find_map(|k| body[k].as_str())
        .map(|m| m.chars().filter(|c| !c.is_control()).take(200).collect())
        .unwrap_or_else(|| "request rejected".into())
}

/// File number in a name like `3.png` or `stamps/3.png` (for ordering; unnumbered names sort last).
pub(super) fn file_number(name: &str) -> (u64, String) {
    let stem = name
        .rsplit('/')
        .next()
        .unwrap_or(name)
        .trim_end_matches(".png")
        .trim_end_matches(".PNG");
    (stem.parse().unwrap_or(u64::MAX), name.to_string())
}

/// PNG images of a download that is either a bare PNG or a ZIP of PNGs (in file number order).
pub(super) fn extract_pngs(data: &[u8]) -> Option<Vec<Vec<u8>>> {
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
        archive
            .by_name(name)
            .ok()?
            .take(MAX_DOWNLOAD_BYTES as u64)
            .read_to_end(&mut png)
            .ok()?;
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
        Self {
            http,
            settings,
            products: Mutex::new(None),
        }
    }

    pub async fn products(&self) -> Result<Vec<Product>, ApiError> {
        if let Some((at, list)) = &*self.products.lock().unwrap_or_else(PoisonError::into_inner) {
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
            return Err(upstream(format!(
                "product list unavailable ({status}): {}",
                upstream_message(&body)
            )));
        }
        let list = parse_products(&body);
        if list.is_empty() {
            tracing::warn!(
                event = "postage_no_products",
                raw = body["shortSalesProducts"].as_array().map_or(0, Vec::len)
            );
        }
        *self.products.lock().unwrap_or_else(PoisonError::into_inner) =
            Some((Instant::now(), list.clone()));
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
        let Some(token) = body["access_token"]
            .as_str()
            .filter(|_| status.is_success())
        else {
            return Err(upstream(format!("login failed ({status})")));
        };
        let wallet = num(&body["walletBalance"])
            .or_else(|| num(&body["walletBallance"]))
            .map(|v| v as i64);
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
        if body
            .to_string()
            .to_lowercase()
            .contains("walletbalancenotenough")
        {
            return Err(error(
                StatusCode::PAYMENT_REQUIRED,
                "postage_wallet_insufficient",
                "the Portokasse balance is too low",
            ));
        }
        Err(upstream(format!(
            "{path} rejected ({status}): {}",
            upstream_message(&body)
        )))
    }

    pub(super) async fn download(&self, link: &str) -> Result<Vec<Vec<u8>>, ApiError> {
        let url = reqwest::Url::parse(link).map_err(|_| upstream("the stamp link is invalid"))?;
        if (self.settings.require_https && (url.scheme() != "https" || url.domain().is_none()))
            || url.username() != ""
        {
            return Err(upstream("the stamp link is not an https link"));
        }
        // No Authorization header: the link may point to another host than the API.
        let mut response = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|e| unreachable_upstream(&e))?;
        if !response.status().is_success() {
            return Err(upstream(format!(
                "stamp download failed ({})",
                response.status()
            )));
        }
        let mut data = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| unreachable_upstream(&e))?
        {
            data.extend_from_slice(&chunk);
            if data.len() > MAX_DOWNLOAD_BYTES {
                return Err(upstream("the stamp download is too large"));
            }
        }
        extract_pngs(&data).ok_or_else(|| upstream("the stamp download is not a PNG"))
    }

    /// Buys `count` franking marks of `product` in one cart (all or nothing) from the Portokasse of `creds`.
    pub async fn buy(
        &self,
        product: &Product,
        count: usize,
        creds: &Credentials,
    ) -> Result<Vec<Stamp>, ApiError> {
        let total = i64::from(product.price_cents) * count as i64;
        let (token, wallet) = self.login(creds).await?;
        if wallet.is_some_and(|w| w < total) {
            return Err(error(
                StatusCode::PAYMENT_REQUIRED,
                "postage_wallet_insufficient",
                "the Portokasse balance is too low",
            ));
        }
        let cart = self
            .post_json(&token, "/app/shoppingcart", &json!({}))
            .await?;
        let shop_order_id = cart["shopOrderId"]
            .as_str()
            .ok_or_else(|| upstream("no shopOrderId in the cart response"))?
            .to_string();
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
        let checkout = self
            .post_json(&token, "/app/shoppingcart/png?directCheckout=true", &body)
            .await?;
        let voucher_ids: Vec<String> = (0..count)
            .map(|i| {
                checkout["shoppingCart"]["voucherList"][i]["voucherId"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string()
            })
            .collect();
        let wallet_balance_cents = num(&checkout["walletBalance"])
            .or_else(|| num(&checkout["walletBallance"]))
            .map(|v| v as i64);
        let Some(link) = checkout["link"].as_str() else {
            return Err(lost_download(&shop_order_id, "no download link"));
        };
        self.fetch_stamps(link, &voucher_ids, &shop_order_id, wallet_balance_cents)
            .await
    }

    /// Downloads the images of a paid order and pairs them with the voucher ids. From here on the
    /// stamps are paid, so a failure must say so and name the order.
    async fn fetch_stamps(
        &self,
        link: &str,
        voucher_ids: &[String],
        shop_order_id: &str,
        wallet_balance_cents: Option<i64>,
    ) -> Result<Vec<Stamp>, ApiError> {
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
        Err(lost_download(
            shop_order_id,
            last.as_deref().unwrap_or("unknown error"),
        ))
    }

    /// Fetches the stamps of an already paid order again (`GET /app/shoppingcart/{shopOrderId}`), e.g. after
    /// `postage_download_failed`. Costs no postage.
    pub async fn recover(
        &self,
        shop_order_id: &str,
        creds: &Credentials,
    ) -> Result<Vec<Stamp>, ApiError> {
        let (token, wallet) = self.login(creds).await?;
        let response = self
            .http
            .get(format!(
                "{}/app/shoppingcart/{shop_order_id}",
                self.settings.shipping_url
            ))
            .bearer_auth(&token)
            .header("dhl-api-key", &self.settings.client_id)
            .send()
            .await
            .map_err(|e| unreachable_upstream(&e))?;
        let status = response.status();
        let body: Value = response.json().await.unwrap_or(Value::Null);
        if matches!(status.as_u16(), 400 | 404) {
            return Err(error(
                StatusCode::NOT_FOUND,
                "postage_order_not_found",
                "this order does not exist in the Portokasse of this login",
            ));
        }
        if !status.is_success() {
            return Err(upstream(format!(
                "order lookup rejected ({status}): {}",
                upstream_message(&body)
            )));
        }
        let voucher_ids: Vec<String> = body["shoppingCart"]["voucherList"]
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(|v| v["voucherId"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let link = body["link"].as_str().filter(|_| !voucher_ids.is_empty());
        let Some(link) = link else {
            return Err(lost_download(
                shop_order_id,
                "the order has no stamps or no download link",
            ));
        };
        self.fetch_stamps(link, &voucher_ids, shop_order_id, wallet)
            .await
    }
}

pub(super) fn lost_download(shop_order_id: &str, why: &str) -> ApiError {
    error(
        StatusCode::BAD_GATEWAY,
        "postage_download_failed",
        format!("the stamps were bought but could not be downloaded ({why}); find order {shop_order_id} in your Portokasse"),
    )
}
