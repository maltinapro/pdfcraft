# 5. Tokens and Rate Limiting

The `/v1` API needs a **token**. There are three kinds: free and purchased tokens (below) and [static service tokens](#static-service-tokens) that the operator configures. All are only a rate limit with different numbers; the stored data is minimal (see below).

| | Free token (`pf_...`) | Purchased token (`pk_...`) |
| --- | --- | --- |
| For | the demo configurator (see [Free Token](11-free-token-and-anubis.md)) | productive use |
| Limit | static: `FREE_RATE_LIMIT_PER_MINUTE` (default 20 invoices/minute) | depends on the plan, see `PAID_PLANS` |
| Lifetime | `FREE_TOKEN_TTL_SECONDS` (default 12 h), then deleted by Valkey | until its end date; renewable by token id |
| PDF output | marked with the watermark "Entwurf" | no watermark (unless the request sets `options.watermark: "draft"`) |
| Feature flag | always on | `PAID_TOKENS_ENABLED=true` (default **off**) |

Send the token as `Authorization: Bearer <token>` or `X-API-Key: <token>`.

## What is stored (Valkey only)

Nothing else is stored: no company names, no invoice data, no e-mail addresses.

| Key | Content | Expiry |
| --- | --- | --- |
| `pdfcraft:token:<id>` | hash: `h` (SHA-256 of the secret), `kind`, `plan`, `limit`, `until` (unix seconds) | free: at `until`. Paid: `until` + `PAID_TOKEN_RETENTION_DAYS` (default 365) |
| `pdfcraft:tokens` | set of token ids (index for `tokens list` and the `tokens_active` metric; stale ids are removed lazily) | – |
| `pdfcraft:rl:<id>` | rate-limit bucket (`tokens`, `ts`) | 120 s of inactivity |

A token looks like `pk_<id>_<secret>`. The `id` (12 hex characters) is **not secret**; it identifies the token, for example for renewal. The secret is shown once and only its hash is stored.

A paid token is **invalid after `until`** but stays in Valkey for the retention time, so a customer can renew it with the token id (monthly subscription: the payment extends `until`; the long retention just cleans up abandoned tokens). Free tokens vanish right after expiry.

## Plans

A **plan** is only a name for a rate limit of purchased tokens. `--plan starter` gives the token the limit that `PAID_PLANS` assigns to `starter`. Default: `PAID_PLANS=starter=30,business=100,pro=300` (`name=invoices_per_minute`, so `starter` = 30 invoices per minute). Add or change plans in that variable; the limit is stored with the token when it is created. `--days N` is the lifetime (the previous example in the PR description had a typo: it is `--days 30`). Free tokens have no plan; their limit is `FREE_RATE_LIMIT_PER_MINUTE`.

## Static service tokens

For a backend service that calls `/v1` on behalf of its own users (for example one token per tenant), a token without expiry and without a rotation job is easier than a purchased token. The operator configures these tokens; nothing about them is stored in Valkey, so they are accepted **without a Valkey entry** and `/v1` also works when `VALKEY_URL` is not set at all.

1. Generate a token and its configuration entry (needs no Valkey and no other configuration):

   ```bash
   pdfcraft-backend tokens create-service tenant-a --limit 120     # 120 invoices per minute
   pdfcraft-backend tokens create-service tenant-b --plan business # limit of a PAID_PLANS plan
   ```

   The command prints the token **once** (`ps_` + 48 random hex characters; give it to the caller) and the entry `<id>:<sha256 hex of the token>:<limit>`. Any other token works as well if it is long and random (at least 128 bits): the entry is the SHA-256 of the whole token, for example `printf %s "$TOKEN" | sha256sum`.
2. Put the entries into `SERVICE_TOKENS` (comma or newline separated) or, better, into a file or mounted secret referenced by `SERVICE_TOKENS_FILE` (one entry per line, lines starting with `#` are comments). Both can be used together. Helm: `backend.serviceTokensSecret`.
3. Restart the backend (the configuration is read at start-up; remove an entry to revoke a token).

```text
# tenant-a: 120 invoices per minute
tenant-a:5b3e06d7d041e98893fe134ef30cb30fbca1be4b89274eac0b5f38cff664966b:120
tenant-b:0f8f5b0d5e8d6c1d9d1ed8f4f4f3a3e0e1a1d2f9e8a0f3b4c5d6e7f8091a2b3c:business
```

- `<id>` is a public label (1–64 characters of letters, digits, `.`, `_`, `-`) that appears in logs (`token_id`) and `GET /v1/token`; it must be unique. `<limit>` is a number of invoices per minute or a plan name from `PAID_PLANS`; a bulk request costs one unit per document, as for every token.
- Only the hash is ever configured: the server never reads, stores or logs a plain token (an invalid entry is reported at start-up by its position and id only).
- Service tokens are not subject to `PAID_TOKENS_ENABLED`, have no watermark and no expiry (`GET /v1/token` answers `kind: "service"`, `expiresAt: null`). Metrics and logs use `token_kind="service"` and the plan label `service` (or the named plan).
- Rate limit: with `VALKEY_URL` set the token bucket is shared by all instances like for other tokens (Valkey outage: `503`). Without Valkey it lives in the process memory of each instance, so with `n` replicas the effective limit is up to `n` times higher.
- Without Valkey these endpoints are not available: free tokens (`/v1/free-token`), purchases and the Internetmarke endpoints (`/v1/postage/*`). An unknown token then simply answers `401`.

## Operator commands

Run against the same `VALKEY_URL` as the server:

```bash
pdfcraft-backend tokens create --plan pro --days 30    # paid token (plan from PAID_PLANS)
pdfcraft-backend tokens create-free                    # free token, for tests
pdfcraft-backend tokens create-service <id> --limit 120 # static service token (no Valkey needed, see above)
pdfcraft-backend tokens list                           # id, kind, plan, limit, valid until
pdfcraft-backend tokens extend <id> --days 30          # renew a paid token
pdfcraft-backend tokens revoke <id>                    # delete immediately
```

From source: `cargo run -- tokens ...`; in Docker: `docker compose run --rm backend /app/pdfcraft-backend tokens ...`. Changes apply immediately on every instance (no caching).

`PAID_TOKENS_ENABLED=false` makes the server answer `401` for paid tokens even if they exist; see [Purchased Tokens (Mollie)](12-paid-tokens-mollie.md) for the switch-on guide.

## Rate limit semantics

- Sizing: measure with `cd backend && cargo test --release bench_render -- --ignored --nocapture` (3 items ≈ 5 ms, 60 items ≈ 27 ms of CPU on a 2-core dev machine); the demo server needs about **100 ms** per PDF end to end, so plan with that: **~600 PDFs per minute and core**, and keep the sustained load at about half of it (**~300 per minute and core**) so that latency stays low. The live preview renders with the same token (every pause of 600 ms while typing), a working editor produces about 5–10 renders per minute and a limit below about 20 per minute makes editing stall; this is why free = 20 and Starter = 30. Rule of thumb: ~40–50 users editing at the same time per core.
- The per-token limit protects against a single heavy user, **not** against many users together: 15 tokens that all use their full 20 per minute already fill one core. Scale with `MAX_CONCURRENT_COMPILES` = CPU limit of the pod (Helm: `backend.resources.limits.cpu`) or more replicas (the limits live in Valkey and are shared). If all compile slots stay busy for `COMPILE_QUEUE_TIMEOUT_SECS` (default 10 s), the request is answered with `503 server_busy` (+ `Retry-After`) instead of queueing without bound; watch `pdfcraft_compile_queue_wait_seconds` and `pdfcraft_compile_slots_in_use` (docs/13) and raise CPU before that happens.
- The limit of a paid token is stored when the token is created: changing `PAID_PLANS` does not affect existing paid tokens (create a new one or extend/replace it). A bulk request costs one limit unit per document, so the limit is also the largest bulk a token can request per minute.
- Algorithm: token bucket per token id. Capacity equals the per-minute limit; it refills continuously (limit / 60 per second).
- Cost: **1 per invoice**. A bulk request of 50 invoices costs 50 and is accepted or rejected as a whole. A bulk request larger than the limit is rejected immediately.
- Stamp purchases (Internetmarke, optional) cost more: **5** per `POST /v1/postage/stamps`, **2** per `POST /v1/postage/stamps/recover` (fetching a paid order again), and `4 + n` per bulk purchase of `n` stamps (see [Internetmarke](14-internetmarke-integration.md)).
- Too many requests: `429 rate_limited` with a `Retry-After` header (seconds).
- The bucket lives in Valkey (atomic Lua script), so any number of backend instances share it.
- The free limit is read from the configuration on every request, so changing `FREE_RATE_LIMIT_PER_MINUTE` applies to existing free tokens.
- Outage: if Valkey is configured but unreachable, or neither Valkey nor a service token is configured, `/v1` answers `503 store_unavailable` (fail closed).
- Separate from the rate limit, `MAX_CONCURRENT_COMPILES` caps simultaneous compilations.

## Error responses

All errors are JSON: `{"error": "<code>", "details": "<text>"}`.

| Status | `error` | Meaning |
| --- | --- | --- |
| 400 | `validation_error` | Input invalid; `details` lists the problems with their paths |
| 400 | `invalid_request` | Malformed JSON, empty or too large `invoices` list |
| 401 | `unauthorized` | Missing, wrong, expired or revoked token (or one not listed in `SERVICE_TOKENS`); purchased tokens while disabled (`WWW-Authenticate: Bearer`) |
| 413 | `invalid_request` | Body larger than 2 MB |
| 422 | `typst_compile_error` | Template compile problem (should not happen with validated input; report it) |
| 429 | `rate_limited` | Limit reached; see `Retry-After` |
| 503 | `store_unavailable` | Valkey missing or unreachable |
| 503 | `server_busy` | All compile slots stayed busy for `COMPILE_QUEUE_TIMEOUT_SECS`; retry after `Retry-After` |

## Security notes

- Tokens are bearer secrets. Always terminate TLS in front of the backend. A service token does not expire, so keep it in your caller's secret store and replace it (new entry, remove the old one) if it leaks.
- Limits are per **token**, not per IP.
- Valkey must not be reachable from outside (private network or password) and must persist its data (append-only file), otherwise purchased tokens are lost on restart.
