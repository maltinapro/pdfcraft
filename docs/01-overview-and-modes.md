# 1. Overview and Run Modes

## Components

| Component | Technology | Purpose |
| --- | --- | --- |
| Frontend | React + Vite, served as static files (nginx in Docker) | Form-based invoice configurator, live PDF preview, config import/export |
| Backend | Rust + Axum | Renders the Typst template and returns PDFs |
| Typst packages | Vendored in `backend/vendor/typst-packages` | `invoice-pro` (our fork) and its dependencies; no internet access needed at runtime |
| Postgres (optional) | any recent Postgres | Stores customer API keys as SHA-256 hashes |
| Redis (optional) | any recent Redis | Rate limit shared by all backend instances |

The backend is stateless apart from those optional services. It keeps **no** rendered PDFs or customer data between requests (by design).

## Endpoints

| Endpoint | Auth | Who uses it | Notes |
| --- | --- | --- | --- |
| `GET /health` | none | load balancers, monitoring | `{"status":"ok"}` |
| `POST /generate-pdf` | **none** | the frontend (preview and download) | Accepts `{template, data, assets}` with an **arbitrary Typst template**. Can be switched off |
| `POST /v1/invoices` | API key | customer systems | One invoice → PDF. Fixed server-side template, strict validation |
| `POST /v1/invoices/bulk` | API key | customer systems | Many invoices → ZIP of PDFs |

Rule of thumb: **the frontend uses `/generate-pdf`; customers use `/v1`.** An API key must never be placed in the frontend, because everything in a browser bundle is public.

## Run modes

| Mode | Frontend | `/generate-pdf` | `/v1` | Keys | Rate limit | Typical use |
| --- | --- | --- | --- | --- | --- | --- |
| **A. Local dev** | `npm run dev` | on | off (no keys) | – | – | developing, trying the UI |
| **B. Local API test** | optional | on | on | `API_KEYS=secret` | in-memory | testing `/v1` and bulk with curl |
| **C. Local full stack** | optional | on | on | Postgres | Redis | testing keys, revocation, shared limit with 2+ instances |
| **D. Demo** | public, built for the demo backend | on, protected at the proxy | off | – | proxy-level | showing prospects the configurator |
| **E. Production** | not needed (or separate) | **off** | on | Postgres | Redis | customers integrating the API |

How the backend decides:

- `/v1` answers `503 api_keys_not_configured` while neither `API_KEYS` nor `DATABASE_URL` is set.
- With `DATABASE_URL` set, keys are looked up in Postgres (static `API_KEYS` still work in addition).
- With `REDIS_URL` set, the rate limit is shared across instances. If Redis is unset or unreachable, each instance falls back to its own in-memory limit.
- `ENABLE_GENERATE_PDF=false` removes `/generate-pdf` completely (404).

Start-up prints which endpoints are active and which key store / limiter is in use, for example:

```
POST /v1/invoices          — one invoice -> PDF (API key required)
API keys: Postgres; rate limit: Redis (shared)
```

## Two JSON formats (do not mix them up)

| File | Created by | Content | Accepted by |
| --- | --- | --- | --- |
| `pdfcraft-config.json` | button **Exportieren** | `{ schemaVersion, settings, invoice }` | frontend import and `POST /v1/invoices` |
| `pdfcraft-request.json` | button **API-Request** | `{ template, data, assets }` | `POST /generate-pdf` |

The template is the static file `frontend/src/template/invoice.typ`. The frontend bundles it and sends it with every `/generate-pdf` request; the backend embeds the same file for `/v1`.
