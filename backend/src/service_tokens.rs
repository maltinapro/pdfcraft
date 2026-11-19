//! Static service tokens: long-lived tokens without expiry that the operator configures
//! (`SERVICE_TOKENS` / `SERVICE_TOKENS_FILE`), e.g. one per tenant of a service that calls `/v1`
//! on behalf of its users. They need no Valkey entry, so `/v1` also works without Valkey.
//!
//! Only the SHA-256 hash of a token is configured, one entry per token as
//! `<id>:<sha256 hex of the whole token>:<limit>`. Entries are separated by newlines or commas,
//! lines starting with `#` are comments. `<id>` is a public label (letters, digits, `.`, `_`, `-`,
//! at most 64 characters) used in logs and metrics; `<limit>` is a plan from `PAID_PLANS` or a
//! number of invoices per minute. Plain tokens are never read, stored or logged by the server:
//! `pdfcraft-backend tokens create-service <id> --limit <n>` generates one and prints its entry.
//!
//! Rate limit: the same token bucket as for other tokens, shared through Valkey when `VALKEY_URL`
//! is set, otherwise kept in this process (per instance).

use crate::store::{ct_eq, hash_secret, Client, Kind};
use std::{collections::HashMap, sync::Mutex, time::Instant};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServiceToken {
    pub id: String,
    /// SHA-256 of the whole token, lowercase hex.
    pub hash: String,
    /// Plan name (a `PAID_PLANS` entry) or `service`; usable as a metric label.
    pub plan: String,
    /// Invoices per minute.
    pub limit: u32,
}

/// Parses the entries of `raw`. Returns the valid tokens and one message per rejected entry;
/// the messages name the entry's position and id, never its hash.
pub fn parse(raw: &str, plans: &[(String, u32)]) -> (Vec<ServiceToken>, Vec<String>) {
    let mut tokens: Vec<ServiceToken> = Vec::new();
    let mut problems = Vec::new();
    let entries = raw
        .lines()
        .filter(|line| !line.trim_start().starts_with('#'))
        .flat_map(|line| line.split(','))
        .map(str::trim)
        .filter(|entry| !entry.is_empty());
    for (n, entry) in entries.enumerate() {
        let n = n + 1;
        let mut fields = entry.splitn(3, ':').map(str::trim);
        let (Some(id), Some(hash), Some(limit)) = (fields.next(), fields.next(), fields.next())
        else {
            problems.push(format!(
                "entry {n}: expected <id>:<sha256 hex>:<plan or invoices per minute>"
            ));
            continue;
        };
        let valid_id = !id.is_empty()
            && id.len() <= 64
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
        if !valid_id {
            problems.push(format!(
                "entry {n}: the id must be 1-64 characters of letters, digits, `.`, `_` or `-`"
            ));
            continue;
        }
        if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            problems.push(format!(
                "entry {n} ({id}): the hash must be 64 hex characters (SHA-256 of the token)"
            ));
            continue;
        }
        let (plan, limit) = match limit.parse::<u32>() {
            Ok(limit) if limit > 0 => ("service".to_string(), limit),
            Ok(_) => {
                problems.push(format!("entry {n} ({id}): the limit must be at least 1"));
                continue;
            }
            Err(_) => {
                let plan = limit.to_ascii_lowercase();
                match plans.iter().find(|(name, _)| *name == plan) {
                    Some((_, limit)) => (plan, *limit),
                    None => {
                        problems.push(format!(
                            "entry {n} ({id}): `{limit}` is neither a number nor a plan from PAID_PLANS"
                        ));
                        continue;
                    }
                }
            }
        };
        let hash = hash.to_ascii_lowercase();
        if tokens.iter().any(|t| t.id == id || t.hash == hash) {
            problems.push(format!("entry {n} ({id}): duplicate id or token"));
            continue;
        }
        tokens.push(ServiceToken {
            id: id.to_string(),
            hash,
            plan,
            limit,
        });
    }
    (tokens, problems)
}

/// Reads `SERVICE_TOKENS` and the file named by `SERVICE_TOKENS_FILE` (both are used when both
/// are set). Invalid entries and an unreadable file are logged and skipped.
pub fn load(plans: &[(String, u32)]) -> Vec<ServiceToken> {
    let mut raw = std::env::var("SERVICE_TOKENS").unwrap_or_default();
    if let Some(path) = std::env::var("SERVICE_TOKENS_FILE")
        .ok()
        .filter(|p| !p.trim().is_empty())
    {
        match std::fs::read_to_string(path.trim()) {
            Ok(content) => {
                raw.push('\n');
                raw.push_str(&content);
            }
            Err(e) => {
                tracing::error!(event = "service_tokens_file_unreadable", path = %path, error = %e)
            }
        }
    }
    let (tokens, problems) = parse(&raw, plans);
    for problem in problems {
        tracing::warn!(event = "invalid_config", name = "SERVICE_TOKENS", %problem);
    }
    tokens
}

fn client_of(token: &ServiceToken) -> Client {
    Client {
        id: token.id.clone(),
        kind: Kind::Service,
        plan: token.plan.clone(),
        limit: token.limit,
        created: None,
    }
}

/// The service token that `presented` is, if any. Every entry is compared (no early exit).
pub fn find(tokens: &[ServiceToken], presented: &str) -> Option<Client> {
    if tokens.is_empty() || presented.is_empty() {
        return None;
    }
    let hash = hash_secret(presented);
    let mut found = None;
    for token in tokens {
        if ct_eq(token.hash.as_bytes(), hash.as_bytes()) {
            found = Some(token);
        }
    }
    found.map(client_of)
}

pub fn lookup(presented: &str) -> Option<Client> {
    find(&crate::config::get().service_tokens, presented)
}

/// Token bucket state of one token: capacity `limit`, refilled with `limit / 60` per second.
struct Bucket {
    tokens: f64,
    at: Instant,
}

impl Bucket {
    /// `Ok(())` if `cost` was taken, otherwise the seconds to wait.
    fn take(&mut self, limit: u32, cost: u32, now: Instant) -> Result<(), u64> {
        let capacity = limit as f64;
        let per_sec = capacity / 60.0;
        let elapsed = now.saturating_duration_since(self.at).as_secs_f64();
        self.tokens = (self.tokens + elapsed * per_sec).min(capacity);
        self.at = now;
        let cost = cost as f64;
        if self.tokens >= cost {
            self.tokens -= cost;
            Ok(())
        } else {
            Err((((cost - self.tokens) / per_sec).ceil() as u64).max(1))
        }
    }
}

static BUCKETS: Mutex<Option<HashMap<String, Bucket>>> = Mutex::new(None);

/// In-process rate limit (used when there is no Valkey): `Ok(())` if allowed, otherwise the
/// seconds to wait. One bucket per configured token, so memory is bounded by the configuration.
pub fn take(client: &Client, cost: u32) -> Result<(), u64> {
    let now = Instant::now();
    let mut guard = BUCKETS.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .get_or_insert_with(HashMap::new)
        .entry(client.id.clone())
        .or_insert_with(|| Bucket {
            tokens: client.limit as f64,
            at: now,
        })
        .take(client.limit, cost, now)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn plans() -> Vec<(String, u32)> {
        vec![("pro".into(), 300)]
    }

    fn entry(id: &str, token: &str, limit: &str) -> String {
        format!("{id}:{}:{limit}", hash_secret(token))
    }

    #[test]
    fn parses_entries_from_lines_and_commas_and_skips_comments() {
        let raw = format!(
            "# tenants\n{}\n  {} , {}\n\n",
            entry("tenant-a", "ps_a", "120"),
            entry("tenant.b", "ps_b", "PRO"),
            entry("c_3", "ps_c", "1")
        );
        let (tokens, problems) = parse(&raw, &plans());
        assert!(problems.is_empty(), "{problems:?}");
        let summary: Vec<_> = tokens
            .iter()
            .map(|t| (t.id.as_str(), t.plan.as_str(), t.limit))
            .collect();
        assert_eq!(
            summary,
            [
                ("tenant-a", "service", 120),
                ("tenant.b", "pro", 300),
                ("c_3", "service", 1)
            ]
        );
    }

    #[test]
    fn rejects_malformed_entries_without_echoing_hashes() {
        let good = hash_secret("ps_a");
        let raw = [
            "no-colons".to_string(),
            format!("bad id:{good}:10"),
            format!(":{good}:10"),
            "short:abcd:10".to_string(),
            format!("zero:{good}:0"),
            format!("unknown:{good}:gold"),
            format!("ok:{good}:10"),
            format!("dup-id:{}:10", hash_secret("other")),
            format!("dup-id:{}:10", hash_secret("another")),
            format!("dup-token:{good}:10"),
        ]
        .join("\n");
        let (tokens, problems) = parse(&raw, &plans());
        let ids: Vec<_> = tokens.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["ok", "dup-id"]);
        assert_eq!(problems.len(), 8, "{problems:?}");
        assert!(problems.iter().all(|p| !p.contains(&good)));
    }

    #[test]
    fn finds_only_the_exact_token() {
        let raw = [
            entry("a", "ps_secret_a", "10"),
            // uppercase hex is accepted
            format!("b:{}:20", hash_secret("ps_secret_b").to_ascii_uppercase()),
        ]
        .join("\n");
        let (tokens, problems) = parse(&raw, &plans());
        assert!(problems.is_empty(), "{problems:?}");
        let a = find(&tokens, "ps_secret_a").expect("a");
        assert_eq!(
            (a.id.as_str(), a.kind, a.limit, a.created),
            ("a", Kind::Service, 10, None)
        );
        assert_eq!(find(&tokens, "ps_secret_b").expect("b").limit, 20);
        for presented in [
            "",
            "ps_secret",
            "ps_secret_a ",
            "PS_SECRET_A",
            &hash_secret("ps_secret_a"),
        ] {
            assert!(find(&tokens, presented).is_none(), "{presented:?}");
        }
        assert!(find(&[], "ps_secret_a").is_none());
    }

    #[test]
    fn bucket_allows_the_capacity_then_waits_and_refills() {
        let start = Instant::now();
        let mut bucket = Bucket {
            tokens: 6.0,
            at: start,
        };
        // limit 6/min = one unit every 10 s
        for _ in 0..6 {
            assert_eq!(bucket.take(6, 1, start), Ok(()));
        }
        assert_eq!(bucket.take(6, 1, start), Err(10));
        assert_eq!(bucket.take(6, 1, start + Duration::from_secs(5)), Err(5));
        assert_eq!(bucket.take(6, 1, start + Duration::from_secs(10)), Ok(()));
        // refill never exceeds the capacity
        assert_eq!(bucket.take(6, 6, start + Duration::from_secs(3600)), Ok(()));
        assert_eq!(
            bucket.take(6, 7, start + Duration::from_secs(7200)),
            Err(10)
        );
    }

    #[test]
    fn process_wide_limit_is_per_token() {
        let client = |id: &str| Client {
            id: id.into(),
            kind: Kind::Service,
            plan: "service".into(),
            limit: 2,
            created: None,
        };
        let (a, b) = (client("limit-test-a"), client("limit-test-b"));
        assert!(take(&a, 1).is_ok());
        assert!(take(&a, 1).is_ok());
        assert!(take(&a, 1).is_err());
        assert!(take(&b, 2).is_ok());
    }
}
