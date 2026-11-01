//! `POST /v1/free-token`: hands out a free token to browsers that solved an Anubis
//! challenge (proof of work). Anubis signs a JWT (EdDSA) into a cookie once the
//! challenge is solved; this endpoint verifies the signature with Anubis' public key
//! and allows **one** free token per pass (the JWT hash is remembered in Valkey).
//! Without the cookie there is no way to get a token, so plain REST clients and
//! simple bots are locked out; every new token costs one proof of work.

use crate::config;
use crate::store::{self, Kind};
use crate::ApiError;
use axum::{
    extract::Request,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
struct FreeToken {
    token: String,
    #[serde(rename = "expiresAt")]
    expires_at: u64,
    #[serde(rename = "limitPerMinute")]
    limit_per_minute: u32,
}

fn cookie_value<'a>(req: &'a Request, name: &str) -> Option<&'a str> {
    req.headers()
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(k, _)| *k == name)
        .map(|(_, v)| v)
}

pub fn decode_hex32(hex: &str) -> Option<[u8; 32]> {
    let hex = hex.trim();
    if hex.len() != 64 || !hex.is_ascii() {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).ok()?;
    }
    Some(out)
}

/// Verifies an Anubis JWT. Returns its expiry (unix seconds) if signature, algorithm
/// and time claims are valid.
pub fn verify_jwt(jwt: &str, key: &VerifyingKey, now: u64) -> Option<u64> {
    let mut parts = jwt.split('.');
    let (header_b64, payload_b64, sig_b64) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() {
        return None;
    }
    let header: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(header_b64).ok()?).ok()?;
    if header.get("alg")?.as_str()? != "EdDSA" {
        return None;
    }
    let sig = Signature::from_slice(&URL_SAFE_NO_PAD.decode(sig_b64).ok()?).ok()?;
    key.verify_strict(format!("{header_b64}.{payload_b64}").as_bytes(), &sig).ok()?;
    let claims: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload_b64).ok()?).ok()?;
    let exp = claims.get("exp")?.as_u64()?;
    let nbf_ok = claims.get("nbf").and_then(Value::as_u64).map_or(true, |nbf| nbf <= now + 5);
    (exp > now && nbf_ok).then_some(exp)
}

fn challenge_required() -> ApiError {
    ApiError::new(
        StatusCode::FORBIDDEN,
        "challenge_required",
        "solve the Anubis challenge first (open the app page in a browser)",
    )
}

pub async fn issue(req: Request) -> Result<Response, ApiError> {
    let cfg = config::get();
    let Some(key) = cfg.anubis_public_key_hex.as_deref().and_then(decode_hex32).and_then(|b| VerifyingKey::from_bytes(&b).ok()) else {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "free_token_disabled",
            "free tokens are not enabled on this server (ANUBIS_PUBLIC_KEY_HEX)",
        ));
    };
    let jwt = cookie_value(&req, &cfg.anubis_cookie_name).ok_or_else(challenge_required)?;
    let now = store::now();
    let exp = verify_jwt(jwt, &key, now).ok_or_else(challenge_required)?;

    let unavailable = |_| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "store_unavailable", "the token store (Valkey) is not configured or not reachable");
    // One free token per Anubis pass; the marker lives as long as the pass is valid.
    let marker = format!("pdfcraft:anubis:{}", store::hash_secret(jwt));
    if !store::mark_once(&marker, exp - now).await.map_err(unavailable)? {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "already_issued",
            "this challenge was already used for a free token; solve a new one after it expires",
        ));
    }
    let created = store::create_token(Kind::Free, "free", cfg.free_rate_limit_per_minute, cfg.free_token_ttl_secs)
        .await
        .map_err(unavailable)?;
    tracing::info!(event = "token_created", token_id = %created.id, token_kind = "free", token_plan = "free");
    Ok((
        StatusCode::OK,
        [(header::CACHE_CONTROL, "no-store")],
        Json(FreeToken {
            token: created.token,
            expires_at: created.valid_until,
            limit_per_minute: cfg.free_rate_limit_per_minute,
        }),
    )
        .into_response())
}

/// `anubis-keygen`: prints a key pair for Anubis (`ED25519_PRIVATE_KEY_HEX`) and the
/// backend (`ANUBIS_PUBLIC_KEY_HEX`).
pub fn run_cli(args: &[String]) -> bool {
    if args.first().map(String::as_str) != Some("anubis-keygen") {
        return false;
    }
    use rand::RngCore;
    let mut seed = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut seed);
    let signing = ed25519_dalek::SigningKey::from_bytes(&seed);
    let hex = |b: &[u8]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
    println!("ED25519_PRIVATE_KEY_HEX (Anubis, keep secret): {}", hex(&seed));
    println!("ANUBIS_PUBLIC_KEY_HEX   (backend):             {}", hex(signing.verifying_key().as_bytes()));
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn jwt(sk: &SigningKey, alg: &str, exp: u64) -> String {
        let h = URL_SAFE_NO_PAD.encode(format!(r#"{{"alg":"{alg}","typ":"JWT"}}"#));
        let p = URL_SAFE_NO_PAD.encode(format!(r#"{{"challenge":"abc","exp":{exp},"nbf":1}}"#));
        let sig = sk.sign(format!("{h}.{p}").as_bytes());
        format!("{h}.{p}.{}", URL_SAFE_NO_PAD.encode(sig.to_bytes()))
    }

    #[test]
    fn verifies_anubis_style_jwt() {
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let other = SigningKey::from_bytes(&[8u8; 32]);
        let vk = sk.verifying_key();
        assert_eq!(verify_jwt(&jwt(&sk, "EdDSA", 2000), &vk, 1000), Some(2000));
        assert_eq!(verify_jwt(&jwt(&sk, "EdDSA", 900), &vk, 1000), None, "expired");
        assert_eq!(verify_jwt(&jwt(&other, "EdDSA", 2000), &vk, 1000), None, "wrong key");
        assert_eq!(verify_jwt(&jwt(&sk, "none", 2000), &vk, 1000), None, "wrong alg");
        assert_eq!(verify_jwt("a.b", &vk, 1000), None);
    }
}
