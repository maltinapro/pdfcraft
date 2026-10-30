# 4. Configuration Reference

## Backend environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `BIND_ADDR` | `0.0.0.0:3000` | Listen address |
| `API_KEYS` | – | Comma-separated static API keys. Fine for tests and very small setups; keys are visible in the process environment |
| `DATABASE_URL` | – | Postgres connection string. Enables database-stored keys; table `api_keys` is created automatically. The backend refuses to start if it cannot connect |
| `REDIS_URL` | – | Redis connection string. Enables the rate limit shared by all instances. Unreachable: warning and in-memory fallback |
| `RATE_LIMIT_PER_MINUTE` | `120` | Default invoices per minute per key. Keys in the database carry their own limit (`--limit`) |
| `BULK_MAX_INVOICES` | `100` | Maximum invoices in one bulk request. A bulk request costs one token per invoice, so it must not exceed the key's limit |
| `MAX_CONCURRENT_COMPILES` | CPU count | Simultaneous Typst compilations across all endpoints; further requests wait |
| `CORS_ALLOWED_ORIGINS` | any | Comma-separated browser origins (for example `https://demo.example.com`). `*` or unset allows any |
| `ENABLE_GENERATE_PDF` | `true` | `false` removes `POST /generate-pdf` |
| `TYPST_PACKAGE_PATH` | `<backend>/vendor/typst-packages` | Directory with the vendored Typst packages |

Behavior summary:

| `API_KEYS` | `DATABASE_URL` | `/v1` |
| --- | --- | --- |
| unset | unset | `503 api_keys_not_configured` |
| set | unset | enabled, static keys only |
| unset | set | enabled, database keys only |
| set | set | enabled, both accepted |

| `REDIS_URL` | Rate limit |
| --- | --- |
| set and reachable | shared token bucket per key across all instances |
| unset or unreachable | token bucket per key per instance (N instances allow up to N times the limit) |

## Fixed limits (compile-time constants)

| Limit | Value |
| --- | --- |
| Request body size | 2 MB |
| Assets per `/generate-pdf` request | 8, 1 MB each |
| Logo via `/v1` | 1 MB decoded (the UI limits uploads to 300 KB) |
| Items per invoice (`/v1`) | 500 |
| Text length (`/v1`) | 200 characters for short fields, 2000 for long fields |

## Frontend

| Setting | Where | Default | Meaning |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | build time (`npm run dev` / `npm run build` / Docker build arg) | `http://localhost:3000` | Backend URL as seen by the browser. Empty string = same origin |

Because it is a build-time value, a different backend URL means a new build (a new image).

## Docker Compose variables

| Variable | Used for |
| --- | --- |
| `API_KEYS`, `DATABASE_URL`, `REDIS_URL`, `CORS_ALLOWED_ORIGINS`, `ENABLE_GENERATE_PDF` | passed through to the backend container |
| `POSTGRES_PASSWORD` | password of the optional `postgres` service (default `pdfcraft`) |

## Database schema

Created automatically on first start (or first `keys` command):

```sql
CREATE TABLE api_keys (
  id BIGSERIAL PRIMARY KEY,
  customer TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,          -- SHA-256 hex of the key
  rate_limit_per_minute INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Redis keys: `pdfcraft:rl:<key id>` (hash with `tokens` and `ts`, expires after 120 s of inactivity). No customer data is stored in Redis.
