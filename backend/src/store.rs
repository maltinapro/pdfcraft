//! Valkey-backed state (Redis protocol): API tokens and rate limits. Nothing else
//! is stored - no customer names, no invoice data.
//!
//! Token format: `pf_<id>_<secret>` (free) or `pk_<id>_<secret>` (paid). The `id`
//! (12 hex chars) is not secret and identifies the token (e.g. for renewal); only a
//! SHA-256 hash of the secret is stored, in the hash `pdfcraft:token:<id>`:
//! `h` (secret hash), `kind`, `plan`, `limit` (invoices/minute), `until` (unix seconds).
//!
//! Lifetimes: a free token is deleted by Valkey when it expires (`EXPIRE`). A paid
//! token is invalid after `until` but kept for `PAID_TOKEN_RETENTION_DAYS` so it can be
//! renewed by its id, then Valkey deletes it (`EXPIREAT`).
//!
//! Rate limit: one atomic token bucket per token id (`pdfcraft:rl:<id>`, Lua script).

use crate::config;
use rand::RngCore;
use redis::aio::ConnectionManager;
use sha2::{Digest, Sha256};
use std::{
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

const TOKEN_PREFIX: &str = "pdfcraft:token:";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Free,
    Paid,
}

impl Kind {
    fn as_str(self) -> &'static str {
        self.label()
    }

    /// Stable name used in the store, logs and metric labels.
    pub fn label(self) -> &'static str {
        match self {
            Kind::Free => "free",
            Kind::Paid => "paid",
        }
    }

    fn prefix(self) -> &'static str {
        match self {
            Kind::Free => "pf",
            Kind::Paid => "pk",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Client {
    pub id: String,
    pub kind: Kind,
    /// Plan name (`free` or a paid plan); bounded set, usable as a metric label.
    pub plan: String,
    /// Invoices per minute for this token.
    pub limit: u32,
    /// Unix time the token was created (`None` for tokens created before this was stored).
    pub created: Option<u64>,
}

pub struct Created {
    pub id: String,
    pub token: String,
    pub valid_until: u64,
}

/// The state store cannot be reached.
#[derive(Debug)]
pub struct Unavailable;

static VALKEY: OnceLock<ConnectionManager> = OnceLock::new();

pub fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

pub fn hash_secret(secret: &str) -> String {
    hex(&Sha256::digest(secret.as_bytes()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn random_hex(len: usize) -> String {
    let mut bytes = vec![0u8; len];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex(&bytes)
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    let mut diff = (a.len() != b.len()) as u8;
    for i in 0..a.len().max(b.len()) {
        diff |= a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0);
    }
    diff == 0
}

async fn connect(url: &str) -> redis::RedisResult<ConnectionManager> {
    ConnectionManager::new(redis::Client::open(url)?).await
}

/// Connects to Valkey when `VALKEY_URL` is set. Without it `/v1` answers 503.
pub async fn init() {
    let Some(url) = &config::get().valkey_url else { return };
    match connect(url).await {
        Ok(m) => {
            let _ = VALKEY.set(m);
        }
        Err(e) => tracing::warn!(event = "valkey_connect_failed", error = %e, "cannot connect to VALKEY_URL; /v1 will answer 503"),
    }
}

pub fn is_configured() -> bool {
    VALKEY.get().is_some()
}

fn conn() -> Result<ConnectionManager, Unavailable> {
    VALKEY.get().cloned().ok_or(Unavailable)
}

fn unavailable(e: redis::RedisError) -> Unavailable {
    tracing::error!(event = "valkey_error", error = %e);
    crate::metrics::store_error();
    Unavailable
}

/// Splits `pf_<id>_<secret>` / `pk_<id>_<secret>`.
fn parse_token(presented: &str) -> Option<(Kind, &str, &str)> {
    let mut parts = presented.splitn(3, '_');
    let kind = match parts.next()? {
        "pf" => Kind::Free,
        "pk" => Kind::Paid,
        _ => return None,
    };
    let id = parts.next()?;
    let secret = parts.next()?;
    let hex_only = |s: &str| !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_hexdigit());
    (hex_only(id) && hex_only(secret)).then_some((kind, id, secret))
}

/// `Ok(None)` for unknown, expired or malformed tokens.
pub async fn lookup(presented: &str) -> Result<Option<Client>, Unavailable> {
    let Some((kind, id, secret)) = parse_token(presented) else { return Ok(None) };
    let mut c = conn()?;
    let (hash, stored_kind, limit, until, plan, created): (Option<String>, Option<String>, Option<u32>, Option<u64>, Option<String>, Option<u64>) =
        redis::cmd("HMGET")
            .arg(format!("{TOKEN_PREFIX}{id}"))
            .arg(&["h", "kind", "limit", "until", "plan", "created"])
            .query_async(&mut c)
            .await
            .map_err(unavailable)?;
    let (Some(hash), Some(stored_kind), Some(limit), Some(until)) = (hash, stored_kind, limit, until)
    else {
        return Ok(None);
    };
    let valid = ct_eq(hash.as_bytes(), hash_secret(secret).as_bytes())
        && stored_kind == kind.as_str()
        && until > now();
    // The free limit is static configuration, so changing it applies to existing tokens.
    let limit = match kind {
        Kind::Free => config::get().free_rate_limit_per_minute,
        Kind::Paid => limit.max(1),
    };
    let plan = plan.unwrap_or_else(|| kind.as_str().to_string());
    Ok(valid.then(|| Client { id: id.to_string(), kind, plan, limit, created }))
}

/// Creates a token valid for `ttl_secs`. The plain token is only returned here.
pub async fn create_token(kind: Kind, plan: &str, limit: u32, ttl_secs: u64) -> Result<Created, Unavailable> {
    let id = random_hex(6);
    let secret = random_hex(16);
    let until = now() + ttl_secs;
    let key = format!("{TOKEN_PREFIX}{id}");
    let mut pipe = redis::pipe();
    pipe.atomic()
        .hset_multiple(
            &key,
            &[("h", hash_secret(&secret)), ("kind", kind.as_str().into()), ("plan", plan.into()), ("limit", limit.to_string()), ("until", until.to_string()), ("created", now().to_string())],
        )
        .ignore();
    pipe.cmd("EXPIREAT").arg(&key).arg(expire_at(kind, until)).ignore();
    pipe.query_async::<()>(&mut conn()?).await.map_err(unavailable)?;
    crate::metrics::token_created(kind, plan);
    Ok(Created { token: format!("{}_{id}_{secret}", kind.prefix()), id, valid_until: until })
}

fn expire_at(kind: Kind, until: u64) -> u64 {
    match kind {
        Kind::Free => until,
        Kind::Paid => until + config::get().paid_retention_days * 86_400,
    }
}

/// Extends a paid token by `add_secs` (from its current end, or from now if it already
/// expired). Returns the new end, or `None` if the id is unknown (e.g. past retention).
pub async fn extend_paid_token(id: &str, add_secs: u64) -> Result<Option<u64>, Unavailable> {
    if parse_token(&format!("pk_{id}_00")).is_none() {
        return Ok(None);
    }
    let key = format!("{TOKEN_PREFIX}{id}");
    let mut c = conn()?;
    let (kind, until): (Option<String>, Option<u64>) = redis::cmd("HMGET")
        .arg(&key)
        .arg(&["kind", "until"])
        .query_async(&mut c)
        .await
        .map_err(unavailable)?;
    if kind.as_deref() != Some("paid") {
        return Ok(None);
    }
    let new_until = until.unwrap_or(0).max(now()) + add_secs;
    let mut pipe = redis::pipe();
    pipe.atomic().hset(&key, "until", new_until.to_string()).ignore();
    pipe.cmd("EXPIREAT").arg(&key).arg(expire_at(Kind::Paid, new_until)).ignore();
    pipe.query_async::<()>(&mut c).await.map_err(unavailable)?;
    Ok(Some(new_until))
}

/// Moves a paid token's end to `until` if that is later than the current end.
pub async fn extend_paid_token_to(id: &str, until: u64) -> Result<Option<u64>, Unavailable> {
    if parse_token(&format!("pk_{id}_00")).is_none() {
        return Ok(None);
    }
    let key = format!("{TOKEN_PREFIX}{id}");
    let mut c = conn()?;
    let (kind, current): (Option<String>, Option<u64>) = redis::cmd("HMGET")
        .arg(&key)
        .arg(&["kind", "until"])
        .query_async(&mut c)
        .await
        .map_err(unavailable)?;
    if kind.as_deref() != Some("paid") {
        return Ok(None);
    }
    let new_until = current.unwrap_or(0).max(until);
    let mut pipe = redis::pipe();
    pipe.atomic().hset(&key, "until", new_until.to_string()).ignore();
    pipe.cmd("EXPIREAT").arg(&key).arg(expire_at(Kind::Paid, new_until)).ignore();
    pipe.query_async::<()>(&mut c).await.map_err(unavailable)?;
    Ok(Some(new_until))
}

/// Stores a short-lived value (used for one-time token hand-over after a purchase).
pub async fn put(key: &str, value: &str, ttl_secs: u64) -> Result<(), Unavailable> {
    redis::cmd("SET")
        .arg(key)
        .arg(value)
        .arg("EX")
        .arg(ttl_secs.max(1))
        .query_async::<()>(&mut conn()?)
        .await
        .map_err(unavailable)
}

/// Reads and deletes a value in one step.
pub async fn take_value(key: &str) -> Result<Option<String>, Unavailable> {
    redis::cmd("GETDEL").arg(key).query_async(&mut conn()?).await.map_err(unavailable)
}

pub async fn get_value(key: &str) -> Result<Option<String>, Unavailable> {
    redis::cmd("GET").arg(key).query_async(&mut conn()?).await.map_err(unavailable)
}

pub async fn delete_key(key: &str) -> Result<(), Unavailable> {
    redis::cmd("DEL").arg(key).query_async::<()>(&mut conn()?).await.map_err(unavailable)
}

/// `SET key NX EX ttl`: true if the marker was newly set, false if it already existed.
pub async fn mark_once(key: &str, ttl_secs: u64) -> Result<bool, Unavailable> {
    let set: Option<String> = redis::cmd("SET")
        .arg(key)
        .arg(1)
        .arg("NX")
        .arg("EX")
        .arg(ttl_secs.max(1))
        .query_async(&mut conn()?)
        .await
        .map_err(unavailable)?;
    Ok(set.is_some())
}

pub async fn delete_token(id: &str) -> Result<bool, Unavailable> {
    let n: i64 = redis::cmd("DEL")
        .arg(format!("{TOKEN_PREFIX}{id}"))
        .query_async(&mut conn()?)
        .await
        .map_err(unavailable)?;
    Ok(n > 0)
}

/// Number of currently valid tokens per (kind, plan); used for the `tokens_active` gauge.
pub async fn count_active_tokens() -> Result<std::collections::HashMap<(String, String), u64>, Unavailable> {
    let mut c = conn()?;
    let mut counts = std::collections::HashMap::new();
    let mut cursor: u64 = 0;
    let now = now();
    loop {
        let (next, keys): (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("MATCH")
            .arg(format!("{TOKEN_PREFIX}*"))
            .arg("COUNT")
            .arg(500)
            .query_async(&mut c)
            .await
            .map_err(unavailable)?;
        if !keys.is_empty() {
            let mut pipe = redis::pipe();
            for key in &keys {
                pipe.cmd("HMGET").arg(key).arg(&["kind", "plan", "until"]);
            }
            let rows: Vec<(Option<String>, Option<String>, Option<u64>)> =
                pipe.query_async(&mut c).await.map_err(unavailable)?;
            for (kind, plan, until) in rows {
                if let (Some(kind), Some(until)) = (kind, until) {
                    if until > now {
                        let plan = plan.unwrap_or_else(|| kind.clone());
                        *counts.entry((kind, plan)).or_insert(0) += 1;
                    }
                }
            }
        }
        if next == 0 {
            return Ok(counts);
        }
        cursor = next;
    }
}

/// Atomic token bucket. Returns 0 if allowed, otherwise the seconds to wait.
const BUCKET_SCRIPT: &str = r#"
local capacity = tonumber(ARGV[1])
local per_sec = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local t = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000
local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])
if tokens == nil then tokens = capacity; ts = now end
tokens = math.min(capacity, tokens + math.max(0, now - ts) * per_sec)
local wait = 0
if tokens >= cost then
  tokens = tokens - cost
else
  wait = math.ceil((cost - tokens) / per_sec)
  if wait < 1 then wait = 1 end
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('EXPIRE', KEYS[1], 120)
return wait
"#;

/// `Ok(Ok(()))` if allowed, `Ok(Err(wait_secs))` if the limit is reached.
pub async fn take(client: &Client, cost: u32) -> Result<Result<(), u64>, Unavailable> {
    let per_sec = client.limit as f64 / 60.0;
    let wait: i64 = redis::Script::new(BUCKET_SCRIPT)
        .key(format!("pdfcraft:rl:{}", client.id))
        .arg(client.limit)
        .arg(per_sec)
        .arg(cost)
        .invoke_async(&mut conn()?)
        .await
        .map_err(unavailable)?;
    Ok(if wait == 0 { Ok(()) } else { Err(wait.max(1) as u64) })
}

fn arg_value(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn die(msg: impl std::fmt::Display, code: i32) -> ! {
    eprintln!("{msg}");
    std::process::exit(code)
}

const USAGE: &str = "usage: pdfcraft-backend tokens <create --plan <name> [--days <n>] | create-free | list | extend <id> --days <n> | revoke <id>>";

/// `tokens ...` subcommands for operators. Returns `true` if a command was handled.
pub async fn run_cli(args: &[String]) -> bool {
    if args.first().map(String::as_str) != Some("tokens") {
        return false;
    }
    let cfg = config::get();
    let Some(url) = &cfg.valkey_url else { die("VALKEY_URL must be set", 2) };
    let manager = connect(url).await.unwrap_or_else(|e| die(format!("cannot connect to Valkey: {e}"), 1));
    let _ = VALKEY.set(manager);
    let days = |default: u64| arg_value(args, "--days").and_then(|v| v.parse::<u64>().ok()).unwrap_or(default);
    match args.get(1).map(String::as_str) {
        Some("create") => {
            let Some(plan) = arg_value(args, "--plan").map(|p| p.to_ascii_lowercase()) else { die(USAGE, 2) };
            let Some(limit) = cfg.plan_limit(&plan) else {
                let names: Vec<_> = cfg.paid_plans.iter().map(|(n, _)| n.as_str()).collect();
                die(format!("unknown plan `{plan}` (PAID_PLANS: {})", names.join(", ")), 2)
            };
            let created = create_token(Kind::Paid, &plan, limit, days(30) * 86_400)
                .await
                .unwrap_or_else(|_| die("could not write to Valkey", 1));
            println!("Created paid token `{}` (plan {plan}, {limit} invoices/minute), valid until unix time {}.", created.id, created.valid_until);
            println!("Token (shown only once, store it safely):\n{}", created.token);
            if !cfg.paid_tokens_enabled {
                println!("Note: PAID_TOKENS_ENABLED is not true, the server rejects paid tokens until you enable it.");
            }
        }
        Some("create-free") => {
            let limit = cfg.free_rate_limit_per_minute;
            let created = create_token(Kind::Free, "free", limit, cfg.free_token_ttl_secs)
                .await
                .unwrap_or_else(|_| die("could not write to Valkey", 1));
            println!("Created free token `{}` ({limit} invoices/minute), valid until unix time {}.\n{}", created.id, created.valid_until, created.token);
        }
        Some("list") => {
            let mut c = conn().unwrap_or_else(|_| die("no Valkey", 1));
            let mut cursor = 0u64;
            println!("{:<14} {:<6} {:<12} {:<7} valid until (unix)", "id", "kind", "plan", "limit");
            loop {
                let (next, keys): (u64, Vec<String>) = redis::cmd("SCAN")
                    .arg(cursor)
                    .arg("MATCH")
                    .arg(format!("{TOKEN_PREFIX}*"))
                    .arg("COUNT")
                    .arg(200)
                    .query_async(&mut c)
                    .await
                    .unwrap_or_else(|e| die(format!("scan failed: {e}"), 1));
                for key in keys {
                    let row: Vec<Option<String>> = redis::cmd("HMGET")
                        .arg(&key)
                        .arg(&["kind", "plan", "limit", "until"])
                        .query_async(&mut c)
                        .await
                        .unwrap_or_default();
                    let f = |i: usize| row.get(i).cloned().flatten().unwrap_or_default();
                    println!("{:<14} {:<6} {:<12} {:<7} {}", &key[TOKEN_PREFIX.len()..], f(0), f(1), f(2), f(3));
                }
                cursor = next;
                if cursor == 0 {
                    break;
                }
            }
        }
        Some("extend") => {
            let Some(id) = args.get(2) else { die(USAGE, 2) };
            match extend_paid_token(id, days(30) * 86_400).await {
                Ok(Some(until)) => println!("Token {id} is now valid until unix time {until}."),
                Ok(None) => die(format!("no paid token with id {id}"), 1),
                Err(_) => die("could not write to Valkey", 1),
            }
        }
        Some("revoke") => {
            let Some(id) = args.get(2) else { die(USAGE, 2) };
            match delete_token(id).await {
                Ok(true) => println!("Token {id} deleted."),
                Ok(false) => die(format!("no token with id {id}"), 1),
                Err(_) => die("could not write to Valkey", 1),
            }
        }
        _ => die(USAGE, 2),
    }
    true
}
