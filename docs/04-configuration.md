# 4. Configuration Reference

## Backend environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `BIND_ADDR` | `0.0.0.0:3000` | Listen address |
| `VALKEY_URL` | – | Valkey connection (`redis://host:6379`). Holds tokens and rate limits. Unset or unreachable: `/v1` answers `503`. With authentication: `redis://:PASSWORD@host:6379` (user: `redis://user:PASSWORD@host:6379`), TLS: `rediss://` |
| `VALKEY_MODE` | `auto` | `auto` asks the server (`INFO cluster`) and switches to the cluster client for sharded Valkey (e.g. the official Valkey operator); `standalone` / `cluster` force a mode. Standalone, primary/replica behind one address and cluster all work |
| `FREE_RATE_LIMIT_PER_MINUTE` | `20` | Invoices per minute for every free token (static) |
| `FREE_TOKEN_TTL_SECONDS` | `43200` | Lifetime of a free token (12 h) |
| `ANUBIS_PUBLIC_KEY_HEX` | empty | Public key of the Anubis instance; free tokens are disabled without it ([guide](11-free-token-and-anubis.md)) |
| `ANUBIS_COOKIE_NAME` | `techaro.lol-anubis-auth` | Anubis cookie to read |
| `PAID_TOKENS_ENABLED` | `false` | Feature flag for purchased tokens; off = they are rejected. Purchases (checkout, purchase page) are active only when this and the four Mollie variables below are set |
| `MOLLIE_API_KEY` | empty | Mollie API key (`test_…`/`live_…`); needed when `PAID_TOKENS_ENABLED=true` ([guide](12-paid-tokens-mollie.md)) |
| `PUBLIC_URL` | empty | Public base URL of the backend; Mollie calls `<PUBLIC_URL>/v1/mollie/webhook` |
| `MOLLIE_REDIRECT_URL` | empty | Success page of the customer; `?order=<id>` is appended for `GET /v1/tokens/claim` |
| `PAID_PRICES` | empty | Offers as `plan:days=amount`, for example `starter:31=2.90,starter:365=24.00,business:31=9.90`; `POST /v1/checkout` only sells these |
| `PAID_CURRENCY` | `EUR` | Currency of `PAID_PRICES` |
| `MOLLIE_API_URL` | `https://api.mollie.com/v2` | Override for tests (plain http only on loopback), see `backend/tools/mock_mollie.py` |
| `INTERNETMARKE_ENABLED` | `false` | Feature flag for buying Deutsche Post stamps with the user's own Portokasse ([guide](14-internetmarke-integration.md)) |
| `INTERNETMARKE_CLIENT_ID`, `INTERNETMARKE_CLIENT_SECRET` | empty | DHL developer portal app credentials; needed when `INTERNETMARKE_ENABLED=true` |
| `INTERNETMARKE_SHIPPING_URL`, `INTERNETMARKE_PRODUCTS_URL` | Deutsche Post production URLs | Override for the sandbox |
| `INTERNETMARKE_SANDBOX_SHIPPING_URL` | empty | Test API for **free** tokens (watermarked drafts); paid tokens keep the main API ([guide](14-internetmarke-integration.md#test-stamps-for-free-tokens)) |
| `INTERNETMARKE_SANDBOX_PRODUCTS_URL`, `INTERNETMARKE_SANDBOX_CLIENT_ID`, `INTERNETMARKE_SANDBOX_CLIENT_SECRET` | main values | Optional overrides for the test API |
| `INTERNETMARKE_SANDBOX_USERNAME`, `INTERNETMARKE_SANDBOX_PASSWORD` | empty | Shared test Portokasse login; free-token users then need no login of their own |
| `PAID_GRACE_DAYS` | `3` | Days a subscription token stays valid after the paid period end |
| `PAID_PLANS` | `starter=30,business=100,pro=300` | Paid plans as `name=invoices_per_minute` |
| `PAID_TOKEN_RETENTION_DAYS` | `365` | How long an expired paid token stays in Valkey so it can be renewed by id |
| `BULK_MAX_INVOICES` | `100` | Maximum invoices in one bulk request. A bulk request costs one token per invoice, so it must not exceed the token's limit |
| `MAX_CONCURRENT_COMPILES` | CPU count | Simultaneous Typst compilations across all endpoints; further requests wait |
| `COMPILE_QUEUE_TIMEOUT_SECS` | `10` | How long a request waits for a free compile slot; then it gets `503 server_busy` with `Retry-After: 5` (load shedding instead of an ever longer queue) |
| `CORS_ALLOWED_ORIGINS` | any | Comma-separated browser origins (for example `https://demo.example.com`). `*` or unset allows any |
| `METRICS_ADDR` | `0.0.0.0:9090` | Separate listener for `GET /metrics` (OpenMetrics); `off` disables it. Never expose it through an ingress ([Observability](13-observability.md)) |
| `RUST_LOG` | `info` | Log level/filter (`tracing` env filter syntax, e.g. `info,pdfcraft_backend=debug`); see [Observability](13-observability.md) |
| `LOG_FORMAT` | `json` | `text` switches to human-readable logs for local development |
| `TYPST_PACKAGE_PATH` | `<backend>/vendor/typst-packages` | Directory with the vendored Typst packages |

Without `VALKEY_URL`, `/v1` is unavailable (`503 store_unavailable`); there is no in-memory fallback. See [Tokens and Rate Limiting](05-tokens-and-rate-limiting.md).

## Fixed limits (compile-time constants)

| Limit | Value |
| --- | --- |
| Request body size | 2 MB |
| Logo via `/v1` | 1 MB decoded (the UI limits uploads to 300 KB) |
| Items per invoice (`/v1`) | 500 |
| Text length (`/v1`) | 200 characters for short fields, 2000 for long fields |

## Frontend

| Setting | Where | Default | Meaning |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | build time (`npm run dev` / `npm run build` / Docker build arg) | `http://localhost:3000` | Backend URL as seen by the browser. Empty string = same origin |
| `APP_VERSION` | build time (`npm run build` / Docker build arg) | `dev` | Version shown in the app header and the landing page footer (set to the release tag by the release workflow) |

Because it is a build-time value, a different backend URL means a new build (a new image).

## Fonts

The configurator offers the fonts listed in `FONTS` (`backend/src/invoice.rs` and `frontend/src/lib/types.ts`, keep both in sync). Typst embeds only Libertinus Serif, New Computer Modern and DejaVu Sans Mono; Liberation Sans/Serif, Carlito (Calibri-compatible), Open Sans, Roboto, Lato and DejaVu Sans are installed as Debian packages in the backend image (`backend/Dockerfile`; locally install the same `fonts-*` packages, otherwise Typst falls back to another font). The backend loads all embedded and installed fonts into memory once at startup (typst-as-lib's own font search would re-read and re-parse the font file on every request). Install only the fonts you need. At startup the backend renders a sample invoice per font and logs `font_missing` for fonts that are not available.

## Docker Compose variables

| Variable | Used for |
| --- | --- |
| `CORS_ALLOWED_ORIGINS`, `PAID_TOKENS_ENABLED`, `MOLLIE_API_KEY`, `PUBLIC_URL`, `MOLLIE_REDIRECT_URL`, `MOLLIE_API_URL`, `PAID_PRICES`, `PAID_PLANS`, `INTERNETMARKE_ENABLED`, `INTERNETMARKE_CLIENT_ID`, `INTERNETMARKE_CLIENT_SECRET`, `INTERNETMARKE_SANDBOX_*`, `ANUBIS_PUBLIC_KEY_HEX` | passed through to the backend container (`VALKEY_URL` is preset to the `valkey` service) |

## Valkey data

See [Tokens and Rate Limiting](05-tokens-and-rate-limiting.md#what-is-stored-valkey-only) for the keys. Valkey must persist (`--appendonly yes`, a volume); Compose and the Helm chart do this.

### Valkey authentication (Helm / operator)

The backend authenticates through the connection URL. In the Helm chart, put the URL into a Secret and reference it; a plain `backend.env.VALKEY_URL` would leave the password in the values:

```bash
kubectl create secret generic pdfcraft-valkey --from-literal=VALKEY_URL='redis://:PASSWORD@my-valkey:6379'
# values: valkey.enabled=false, backend.valkeySecret=pdfcraft-valkey
```

Special characters in the password must be URL-encoded. The user needs read/write access to the keys `pdfcraft:*` (or all keys) and Lua `EVAL`.
