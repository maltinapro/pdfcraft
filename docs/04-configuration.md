# 4. Configuration Reference

## Backend environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `BIND_ADDR` | `0.0.0.0:3000` | Listen address |
| `VALKEY_URL` | – | Valkey connection (`redis://host:6379`). Holds tokens and rate limits. Unset or unreachable: `/v1` answers `503` |
| `FREE_RATE_LIMIT_PER_MINUTE` | `20` | Invoices per minute for every free token (static) |
| `FREE_TOKEN_TTL_SECONDS` | `43200` | Lifetime of a free token (12 h) |
| `PAID_TOKENS_ENABLED` | `false` | Feature flag for purchased tokens; off = they are rejected |
| `PAID_PLANS` | `starter=60,business=300,pro=1000` | Paid plans as `name=invoices_per_minute` |
| `PAID_TOKEN_RETENTION_DAYS` | `365` | How long an expired paid token stays in Valkey so it can be renewed by id |
| `BULK_MAX_INVOICES` | `100` | Maximum invoices in one bulk request. A bulk request costs one token per invoice, so it must not exceed the token's limit |
| `MAX_CONCURRENT_COMPILES` | CPU count | Simultaneous Typst compilations across all endpoints; further requests wait |
| `CORS_ALLOWED_ORIGINS` | any | Comma-separated browser origins (for example `https://demo.example.com`). `*` or unset allows any |
| `ENABLE_GENERATE_PDF` | `true` | `false` removes `POST /generate-pdf` |
| `TYPST_PACKAGE_PATH` | `<backend>/vendor/typst-packages` | Directory with the vendored Typst packages |

Without `VALKEY_URL`, `/v1` is unavailable (`503 store_unavailable`); there is no in-memory fallback. See [Tokens and Rate Limiting](05-tokens-and-rate-limiting.md).

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
| `CORS_ALLOWED_ORIGINS`, `ENABLE_GENERATE_PDF`, `PAID_TOKENS_ENABLED` | passed through to the backend container (`VALKEY_URL` is preset to the `valkey` service) |

## Valkey data

See [Tokens and Rate Limiting](05-tokens-and-rate-limiting.md#what-is-stored-valkey-only) for the keys. Valkey must persist (`--appendonly yes`, a volume); Compose and the Helm chart do this.
