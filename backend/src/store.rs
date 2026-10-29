//! Optional shared state for multiple instances:
//! - API keys in Postgres (`DATABASE_URL`), stored only as SHA-256 hashes
//! - rate limit in Redis (`REDIS_URL`), one atomic token bucket per key
//!
//! Without them the backend falls back to `API_KEYS` and an in-memory limiter.

use crate::config;
use rand::RngCore;
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Clone)]
pub struct Client {
    /// Stable identifier used as rate-limit bucket name.
    pub id: String,
    /// Invoices per minute for this client.
    pub limit: u32,
}

static POOL: OnceLock<PgPool> = OnceLock::new();
static REDIS: OnceLock<redis::aio::ConnectionManager> = OnceLock::new();
static CACHE: OnceLock<Mutex<HashMap<String, (Option<Client>, Instant)>>> = OnceLock::new();

const POSITIVE_TTL: Duration = Duration::from_secs(30);
const NEGATIVE_TTL: Duration = Duration::from_secs(5);

pub fn has_database() -> bool {
    POOL.get().is_some()
}

pub fn hash_key(key: &str) -> String {
    Sha256::digest(key.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

async fn connect_pool(url: &str) -> Result<PgPool, sqlx::Error> {
    let pool = PgPoolOptions::new().max_connections(5).connect(url).await?;
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS api_keys (
            id BIGSERIAL PRIMARY KEY,
            customer TEXT NOT NULL,
            key_hash TEXT NOT NULL UNIQUE,
            rate_limit_per_minute INTEGER NOT NULL,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )",
    )
    .execute(&pool)
    .await?;
    Ok(pool)
}

/// Connects to Postgres and Redis when configured. Failing to reach a configured
/// service is fatal for Postgres (keys are required) and a warning for Redis.
pub async fn init() {
    let cfg = config::get();
    if let Some(url) = &cfg.database_url {
        match connect_pool(url).await {
            Ok(pool) => {
                let _ = POOL.set(pool);
            }
            Err(e) => panic!("cannot connect to DATABASE_URL: {e}"),
        }
    }
    if let Some(url) = &cfg.redis_url {
        let manager = async {
            let client = redis::Client::open(url.as_str())?;
            redis::aio::ConnectionManager::new(client).await
        }
        .await;
        match manager {
            Ok(m) => {
                let _ = REDIS.set(m);
            }
            Err(e) => eprintln!("warning: cannot connect to REDIS_URL ({e}); using the in-memory rate limit"),
        }
    }
}

pub fn has_redis() -> bool {
    REDIS.get().is_some()
}

/// Looks up an API key (cached for a few seconds to spare the database).
pub async fn lookup_key(presented: &str) -> Option<Client> {
    let pool = POOL.get()?;
    let hash = hash_key(presented);
    let cache = CACHE.get_or_init(Default::default);
    if let Some((client, at)) = cache.lock().unwrap().get(&hash) {
        let ttl = if client.is_some() { POSITIVE_TTL } else { NEGATIVE_TTL };
        if at.elapsed() < ttl {
            return client.clone();
        }
    }
    let row = sqlx::query(
        "SELECT id, rate_limit_per_minute FROM api_keys WHERE key_hash = $1 AND active",
    )
    .bind(&hash)
    .fetch_optional(pool)
    .await;
    let client = match row {
        Ok(Some(r)) => Some(Client {
            id: format!("db:{}", r.get::<i64, _>("id")),
            limit: r.get::<i32, _>("rate_limit_per_minute").max(1) as u32,
        }),
        Ok(None) => None,
        Err(e) => {
            eprintln!("api key lookup failed: {e}");
            return None;
        }
    };
    let mut map = cache.lock().unwrap();
    if map.len() > 10_000 {
        map.clear();
    }
    map.insert(hash, (client.clone(), Instant::now()));
    client
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

/// `Some(Ok)` / `Some(Err(wait))` when Redis decided, `None` if Redis is unavailable.
pub async fn redis_take(client: &Client, cost: u32) -> Option<Result<(), u64>> {
    let mut conn = REDIS.get()?.clone();
    let per_sec = client.limit as f64 / 60.0;
    let result: redis::RedisResult<i64> = redis::Script::new(BUCKET_SCRIPT)
        .key(format!("pdfcraft:rl:{}", client.id))
        .arg(client.limit)
        .arg(per_sec)
        .arg(cost)
        .invoke_async(&mut conn)
        .await;
    match result {
        Ok(0) => Some(Ok(())),
        Ok(wait) => Some(Err(wait.max(1) as u64)),
        Err(e) => {
            eprintln!("redis rate limit failed ({e}); using the in-memory limit");
            None
        }
    }
}

fn arg_value(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

/// `keys create|list|revoke` subcommands. Returns `true` if a command was handled.
pub async fn run_cli(args: &[String]) -> bool {
    if args.first().map(String::as_str) != Some("keys") {
        return false;
    }
    let Some(url) = config::get().database_url.clone() else {
        eprintln!("DATABASE_URL must be set");
        std::process::exit(2);
    };
    let pool = connect_pool(&url).await.unwrap_or_else(|e| {
        eprintln!("cannot connect to the database: {e}");
        std::process::exit(1);
    });
    match args.get(1).map(String::as_str) {
        Some("create") => {
            let Some(customer) = arg_value(args, "--customer") else {
                eprintln!("usage: keys create --customer <name> [--limit <per minute>]");
                std::process::exit(2);
            };
            let limit: i32 = arg_value(args, "--limit")
                .and_then(|v| v.parse().ok())
                .unwrap_or(config::get().rate_limit_per_minute as i32)
                .max(1);
            let mut bytes = [0u8; 32];
            rand::rngs::OsRng.fill_bytes(&mut bytes);
            let key = format!("pk_{}", bytes.iter().map(|b| format!("{b:02x}")).collect::<String>());
            let id: i64 = sqlx::query(
                "INSERT INTO api_keys (customer, key_hash, rate_limit_per_minute) VALUES ($1, $2, $3) RETURNING id",
            )
            .bind(&customer)
            .bind(hash_key(&key))
            .bind(limit)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| {
                eprintln!("insert failed: {e}");
                std::process::exit(1);
            })
            .get("id");
            println!("Created key #{id} for {customer} ({limit} invoices/minute).");
            println!("API key (shown only once, store it safely):\n{key}");
        }
        Some("list") => {
            let rows = sqlx::query(
                "SELECT id, customer, rate_limit_per_minute, active, created_at::text AS created FROM api_keys ORDER BY id",
            )
            .fetch_all(&pool)
            .await
            .unwrap_or_else(|e| {
                eprintln!("query failed: {e}");
                std::process::exit(1);
            });
            println!("{:<6} {:<28} {:<8} {:<7} created", "id", "customer", "limit", "active");
            for r in rows {
                println!(
                    "{:<6} {:<28} {:<8} {:<7} {}",
                    r.get::<i64, _>("id"),
                    r.get::<String, _>("customer"),
                    r.get::<i32, _>("rate_limit_per_minute"),
                    r.get::<bool, _>("active"),
                    r.get::<String, _>("created"),
                );
            }
        }
        Some(cmd @ ("revoke" | "activate")) => {
            let Some(id) = args.get(2).and_then(|v| v.parse::<i64>().ok()) else {
                eprintln!("usage: keys {cmd} <id>");
                std::process::exit(2);
            };
            let done = sqlx::query("UPDATE api_keys SET active = $2 WHERE id = $1")
                .bind(id)
                .bind(cmd == "activate")
                .execute(&pool)
                .await
                .map(|r| r.rows_affected())
                .unwrap_or(0);
            if done == 0 {
                eprintln!("no key with id {id}");
                std::process::exit(1);
            }
            println!("Key #{id}: {cmd}d (running servers notice within ~30 s).");
        }
        _ => {
            eprintln!("usage: pdfcraft-backend keys <create --customer <name> [--limit <n>] | list | revoke <id> | activate <id>>");
            std::process::exit(2);
        }
    }
    true
}
