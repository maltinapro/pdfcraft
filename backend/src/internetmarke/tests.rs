use super::*;
use axum::{
    extract::State,
    routing::{get, post},
    Router,
};
use std::sync::Arc;

fn zipped(pngs: &[Vec<u8>]) -> Vec<u8> {
    use std::io::Write;
    let mut out = std::io::Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(&mut out);
    // Written in reverse to prove that the file number decides the order.
    for (i, png) in pngs.iter().enumerate().rev() {
        zip.start_file(
            format!("{i}.png"),
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored),
        )
        .unwrap();
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
    let summary: Vec<_> = list
        .iter()
        .map(|p| (p.product_code, p.price_cents))
        .collect();
    assert_eq!(summary, vec![(1, 95), (11, 160), (21, 180)]);
}

#[test]
fn extracts_a_png_from_a_zip_or_a_bare_png() {
    let png = postage::test_png(40, 20, None);
    assert_eq!(extract_pngs(&png).unwrap(), vec![png.clone()]);
    assert_eq!(
        extract_pngs(&zipped(std::slice::from_ref(&png))).unwrap(),
        vec![png]
    );
    assert!(extract_pngs(b"<html>").is_none());
}

#[test]
fn orders_zip_images_by_file_number() {
    let pngs: Vec<Vec<u8>> = (1..=12)
        .map(|i| postage::test_png(10 * i, 20, None))
        .collect();
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
        let password = body
            .split('&')
            .find_map(|p| p.strip_prefix("password="))
            .map(String::from);
        *m.seen_password.lock().unwrap() = password;
        Json(json!({"access_token": "tok", "walletBalance": m.wallet}))
    }
    async fn cart() -> Json<Value> {
        Json(json!({"shopOrderId": "4711"}))
    }
    async fn png(
        State(_): State<Mock>,
        headers: axum::http::HeaderMap,
        Json(body): Json<Value>,
    ) -> Result<Json<Value>, StatusCode> {
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
    async fn order(
        headers: axum::http::HeaderMap,
        axum::extract::Path(id): axum::extract::Path<String>,
    ) -> Result<Json<Value>, StatusCode> {
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
    Credentials {
        username: "me@example.com".into(),
        password: "pw".into(),
    }
}

fn product() -> Product {
    Product {
        product_code: 11,
        name: "Kompaktbrief".into(),
        price_cents: 160,
    }
}

#[tokio::test]
async fn buys_a_stamp_and_downloads_it_without_credentials() {
    let png = postage::test_png(472, 283, None);
    let mock = Mock {
        pngs: Arc::new(vec![png.clone()]),
        wallet: 1000,
        seen_password: Default::default(),
    };
    let base = serve(mock.clone()).await;
    let stamps = client_for(&base)
        .buy(&product(), 1, &creds())
        .await
        .ok()
        .expect("purchase");
    let stamp = &stamps[0];
    assert_eq!(stamp.png, png);
    assert_eq!(
        (stamp.voucher_id.as_str(), stamp.shop_order_id.as_str()),
        ("A0001", "4711")
    );
    assert_eq!(stamp.wallet_balance_cents, Some(840));
    assert_eq!(mock.seen_password.lock().unwrap().as_deref(), Some("pw"));
}

#[tokio::test]
async fn buys_several_stamps_in_one_cart_and_pairs_them_with_voucher_ids() {
    let pngs: Vec<Vec<u8>> = (1..=3)
        .map(|i| postage::test_png(400 + i * 10, 283, None))
        .collect();
    let mock = Mock {
        pngs: Arc::new(pngs.clone()),
        wallet: 1000,
        seen_password: Default::default(),
    };
    let base = serve(mock).await;
    let stamps = client_for(&base)
        .buy(&product(), 3, &creds())
        .await
        .ok()
        .expect("purchase");
    assert_eq!(
        stamps.iter().map(|s| s.png.clone()).collect::<Vec<_>>(),
        pngs
    );
    assert_eq!(
        stamps
            .iter()
            .map(|s| s.voucher_id.as_str())
            .collect::<Vec<_>>(),
        vec!["A0001", "A0002", "A0003"]
    );
    assert_eq!(stamps[0].wallet_balance_cents, Some(520));
}

#[tokio::test]
async fn reports_a_paid_purchase_when_the_image_count_is_wrong() {
    let png = postage::test_png(40, 20, None);
    let mock = Mock {
        pngs: Arc::new(vec![png]),
        wallet: 1000,
        seen_password: Default::default(),
    };
    let base = serve(mock).await;
    let Err(err) = client_for(&base).buy(&product(), 2, &creds()).await else {
        panic!("must fail")
    };
    assert_eq!(err.code, "postage_download_failed");
    assert!(err.details.contains("4711"));
}

#[tokio::test]
async fn refuses_before_buying_when_the_wallet_covers_only_part_of_the_total() {
    let mock = Mock {
        pngs: Arc::new(Vec::new()),
        wallet: 300,
        seen_password: Default::default(),
    };
    let base = serve(mock).await;
    let Err(err) = client_for(&base).buy(&product(), 2, &creds()).await else {
        panic!("must fail")
    };
    assert_eq!(err.code, "postage_wallet_insufficient");
}

#[tokio::test]
async fn fetches_a_paid_order_again_without_buying() {
    let pngs: Vec<Vec<u8>> = (1..=2)
        .map(|i| postage::test_png(400 + i * 10, 283, None))
        .collect();
    let mock = Mock {
        pngs: Arc::new(pngs.clone()),
        wallet: 1000,
        seen_password: Default::default(),
    };
    let base = serve(mock).await;
    let stamps = client_for(&base)
        .recover("4711", &creds())
        .await
        .ok()
        .expect("recover");
    assert_eq!(
        stamps.iter().map(|s| s.png.clone()).collect::<Vec<_>>(),
        pngs
    );
    assert_eq!(
        stamps
            .iter()
            .map(|s| s.voucher_id.as_str())
            .collect::<Vec<_>>(),
        vec!["A0001", "A0002"]
    );
    assert!(stamps.iter().all(|s| s.shop_order_id == "4711"));

    let Err(err) = client_for(&base).recover("999", &creds()).await else {
        panic!("must fail")
    };
    assert_eq!(
        (err.code, err.status),
        ("postage_order_not_found", StatusCode::NOT_FOUND)
    );
}

#[test]
fn a_caller_login_is_required_without_a_shared_test_login() {
    let mode = Mode {
        client: Box::leak(Box::new(client_for("http://127.0.0.1:1"))),
        sandbox: false,
        shared_login: false,
    };
    assert!(mode.credentials(None).is_err());
    assert!(mode
        .credentials(Some(&Credentials {
            username: " ".into(),
            password: "pw".into()
        }))
        .is_err());
    assert!(mode
        .credentials(Some(&Credentials {
            username: "a@b.de".into(),
            password: String::new()
        }))
        .is_err());
    assert_eq!(
        mode.credentials(Some(&creds()))
            .ok()
            .expect("valid")
            .username,
        "me@example.com"
    );
}

#[test]
fn only_local_http_servers_skip_tls() {
    assert!(is_loopback("http://127.0.0.1:9000/im/v1"));
    assert!(is_loopback("http://localhost:9000"));
    assert!(!is_loopback("http://example.com"));
    assert!(!is_loopback("https://127.0.0.1"));
    assert!(!is_loopback(
        "https://api-eu.dhl.com/post/de/shipping/im/v1"
    ));
}

#[tokio::test]
async fn refuses_before_buying_when_the_wallet_is_too_low() {
    let mock = Mock {
        pngs: Arc::new(Vec::new()),
        wallet: 100,
        seen_password: Default::default(),
    };
    let base = serve(mock).await;
    let Err(err) = client_for(&base).buy(&product(), 1, &creds()).await else {
        panic!("must fail")
    };
    assert_eq!(err.code, "postage_wallet_insufficient");
}

#[tokio::test]
async fn refuses_non_https_download_links_by_default() {
    let mut client = client_for("http://127.0.0.1:1");
    client.settings.require_https = true;
    assert!(client.download("http://example.com/0.png").await.is_err());
    assert!(client
        .download("https://user:pw@example.com/0.png")
        .await
        .is_err());
}
