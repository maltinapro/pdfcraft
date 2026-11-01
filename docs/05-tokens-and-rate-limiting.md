# 5. Tokens and Rate Limiting

The `/v1` API needs a **token**. There are two kinds. Both are only a rate limit with different numbers; the stored data is minimal (see below).

| | Free token (`pf_...`) | Purchased token (`pk_...`) |
| --- | --- | --- |
| For | the demo configurator (see [Free Token](11-free-token-and-anubis.md)) | productive use |
| Limit | static: `FREE_RATE_LIMIT_PER_MINUTE` (default 20 invoices/minute) | depends on the plan, see `PAID_PLANS` |
| Lifetime | `FREE_TOKEN_TTL_SECONDS` (default 12 h), then deleted by Valkey | until its end date; renewable by token id |
| PDF output | marked with the watermark "Entwurf" | no watermark |
| Feature flag | always on | `PAID_TOKENS_ENABLED=true` (default **off**) |

Send the token as `Authorization: Bearer <token>` or `X-API-Key: <token>`.

## What is stored (Valkey only)

Nothing else is stored: no company names, no invoice data, no e-mail addresses.

| Key | Content | Expiry |
| --- | --- | --- |
| `pdfcraft:token:<id>` | hash: `h` (SHA-256 of the secret), `kind`, `plan`, `limit`, `until` (unix seconds) | free: at `until`. Paid: `until` + `PAID_TOKEN_RETENTION_DAYS` (default 365) |
| `pdfcraft:rl:<id>` | rate-limit bucket (`tokens`, `ts`) | 120 s of inactivity |

A token looks like `pk_<id>_<secret>`. The `id` (12 hex characters) is **not secret**; it identifies the token, for example for renewal. The secret is shown once and only its hash is stored.

A paid token is **invalid after `until`** but stays in Valkey for the retention time, so a customer can renew it with the token id (monthly subscription: the payment extends `until`; the long retention just cleans up abandoned tokens). Free tokens vanish right after expiry.

## Operator commands

Run against the same `VALKEY_URL` as the server:

```bash
pdfcraft-backend tokens create --plan pro --days 30    # paid token (plan from PAID_PLANS)
pdfcraft-backend tokens create-free                    # free token, for tests
pdfcraft-backend tokens list                           # id, kind, plan, limit, valid until
pdfcraft-backend tokens extend <id> --days 30          # renew a paid token
pdfcraft-backend tokens revoke <id>                    # delete immediately
```

From source: `cargo run -- tokens ...`; in Docker: `docker compose run --rm backend /app/pdfcraft-backend tokens ...`. Changes apply immediately on every instance (no caching).

`PAID_TOKENS_ENABLED=false` makes the server answer `401` for paid tokens even if they exist; see [Purchased Tokens (Stripe)](12-paid-tokens-stripe.md) for the switch-on guide.

## Rate limit semantics

- Algorithm: token bucket per token id. Capacity equals the per-minute limit; it refills continuously (limit / 60 per second).
- Cost: **1 per invoice**. A bulk request of 50 invoices costs 50 and is accepted or rejected as a whole. A bulk request larger than the limit is rejected immediately.
- Too many requests: `429 rate_limited` with a `Retry-After` header (seconds).
- The bucket lives in Valkey (atomic Lua script), so any number of backend instances share it.
- The free limit is read from the configuration on every request, so changing `FREE_RATE_LIMIT_PER_MINUTE` applies to existing free tokens.
- Outage: if Valkey is not configured or unreachable, `/v1` answers `503 store_unavailable` (fail closed).
- Separate from the rate limit, `MAX_CONCURRENT_COMPILES` caps simultaneous compilations.

## Error responses

All errors are JSON: `{"error": "<code>", "details": "<text>"}`.

| Status | `error` | Meaning |
| --- | --- | --- |
| 400 | `validation_error` | Input invalid; `details` lists the problems with their paths |
| 400 | `invalid_request` | Malformed JSON, empty or too large `invoices` list |
| 401 | `unauthorized` | Missing, wrong, expired or revoked token; purchased tokens while disabled (`WWW-Authenticate: Bearer`) |
| 413 | – | Body larger than 2 MB |
| 422 | `typst_compile_error` | Template compile problem (should not happen with validated input; report it) |
| 429 | `rate_limited` | Limit reached; see `Retry-After` |
| 503 | `store_unavailable` | Valkey missing or unreachable |

## Security notes

- Tokens are bearer secrets. Always terminate TLS in front of the backend.
- Limits are per **token**, not per IP.
- Valkey must not be reachable from outside (private network or password) and must persist its data (append-only file), otherwise purchased tokens are lost on restart.
