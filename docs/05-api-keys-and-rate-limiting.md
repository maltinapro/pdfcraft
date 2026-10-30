# 5. API Keys and Rate Limiting

## Which endpoints need a key?

| Endpoint | Key required |
| --- | --- |
| `POST /v1/invoices`, `POST /v1/invoices/bulk` | **Yes** |
| `POST /generate-pdf` (frontend preview) | No |
| `GET /health` | No |

Send the key as `Authorization: Bearer <key>` or `X-API-Key: <key>`.

## Issue a key to a customer

Keys are created with the backend binary against the database (`DATABASE_URL` must be set):

```bash
pdfcraft-backend keys create --customer "ACME GmbH" --limit 300
# Created key #3 for ACME GmbH (300 invoices/minute).
# API key (shown only once, store it safely):
# pk_...
```

- The plaintext key is shown **once** and never stored; only its SHA-256 hash is saved.
- Send the key to the customer over a secure channel. Keys have 256 bits of randomness (`pk_` + 64 hex characters).
- `--limit` is the invoices per minute for this customer (default: `RATE_LIMIT_PER_MINUTE`).

From source: `cargo run -- keys create ...`. In Docker: `docker run --rm -e DATABASE_URL=... pdfcraft-backend /app/pdfcraft-backend keys create --customer ACME`.

## Manage keys

```bash
pdfcraft-backend keys list            # id, customer, limit, active, created
pdfcraft-backend keys revoke 3        # disable in the database
pdfcraft-backend keys activate 3
```

Running servers cache lookups: a valid key for 30 s, an unknown key for 5 s. Revocation therefore takes effect within about 30 seconds on every instance.

To **rotate** a key: create a new key for the customer, let them switch, then revoke the old id.

To change the limit of an existing key, update the row (it applies within about 30 s):

```sql
UPDATE api_keys SET rate_limit_per_minute = 500 WHERE id = 3;
```

Not available yet: key expiry, an admin API or UI, usage statistics.

## Rate limit semantics

- Algorithm: token bucket per key. Capacity equals the per-minute limit; tokens refill continuously (limit / 60 per second).
- Cost: **1 token per invoice**. A bulk request of 50 invoices costs 50 tokens and is accepted or rejected as a whole.
- Too many requests: `429 rate_limited` with a `Retry-After` header (seconds). A single bulk request larger than the limit is rejected immediately.
- Shared limit: with `REDIS_URL`, a Lua script updates the bucket atomically, so any number of instances share one bucket per key.
- Outage behavior: if Redis fails, instances log a warning and use their own in-memory bucket (fail open, limit per instance). If Postgres fails during a lookup, the request gets `401` (keys cached in the last 30 s keep working).
- Separate from the rate limit, `MAX_CONCURRENT_COMPILES` caps simultaneous compilations so one customer cannot saturate the CPU.

## Error responses

All errors are JSON: `{"error": "<code>", "details": "<text>"}`.

| Status | `error` | Meaning |
| --- | --- | --- |
| 400 | `validation_error` | Input invalid; `details` lists the problems with their paths |
| 400 | `invalid_request` | Malformed JSON, empty or too large `invoices` list |
| 401 | `unauthorized` | Missing, wrong or revoked key (`WWW-Authenticate: Bearer`) |
| 413 | – | Body larger than 2 MB |
| 422 | `typst_compile_error` | Template compile problem (should not happen with validated `/v1` input; report it) |
| 429 | `rate_limited` | Limit reached; see `Retry-After` |
| 503 | `api_keys_not_configured` | No key source configured on the server |

## Security notes

- Never put a key into the frontend or any client-side code.
- Prefer database keys over `API_KEYS` in production: they can be revoked individually without a restart and are not visible in the environment.
- Always terminate TLS in front of the backend; keys travel in headers.
- Limits are per **key**, not per IP.
