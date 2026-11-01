# 1. Overview and Run Modes

## Components

| Component | Technology | Purpose |
| --- | --- | --- |
| Frontend | React + Vite, served as static files (nginx in Docker) | Form-based invoice configurator, live PDF preview, config import/export |
| Backend | Rust + Axum | Renders the Typst template and returns PDFs |
| Typst packages | Vendored in `backend/vendor/typst-packages` | `invoice-pro` (our fork) and its dependencies; no internet access needed at runtime |
| Valkey | Valkey 8 (Redis protocol), with persistence | Tokens (hashed) and the rate limit shared by all backend instances. Required for `/v1` |

The backend is stateless apart from Valkey. It keeps **no** rendered PDFs or customer data between requests (by design).

## Endpoints

| Endpoint | Auth | Who uses it | Notes |
| --- | --- | --- | --- |
| `GET /health` | none | load balancers, monitoring | `{"status":"ok"}` |
| `POST /generate-pdf` | **none** | the frontend (preview and download) | Accepts `{template, data, assets}` with an **arbitrary Typst template**. Can be switched off |
| `POST /v1/invoices` | token | customer systems | One invoice → PDF. Fixed server-side template, strict validation |
| `POST /v1/invoices/bulk` | token | customer systems | Many invoices → ZIP of PDFs |

Rule of thumb: **the frontend uses `/generate-pdf`; customers use `/v1`.** Never put a purchased token into the frontend: everything in a browser bundle is public. The demo frontend only holds a short-lived, rate-limited free token.

## Run modes

| Mode | Frontend | `/generate-pdf` | `/v1` | Tokens | Typical use |
| --- | --- | --- | --- | --- | --- |
| **A. Local dev** | `npm run dev` | on | off (no `VALKEY_URL`) | – | developing, trying the UI |
| **B. Local API test** | optional | on | on | Valkey, tokens from the CLI | testing `/v1`, bulk, limits with curl |
| **C. Demo** | public, built for the demo backend | on, protected at the proxy | on | free tokens | showing prospects the configurator |
| **D. Production** | not needed (or separate) | **off** | on | purchased tokens (`PAID_TOKENS_ENABLED=true`) | customers integrating the API |

How the backend decides:

- `/v1` answers `503 store_unavailable` while `VALKEY_URL` is unset or Valkey is unreachable.
- Tokens and rate limits always live in Valkey; see [Tokens and Rate Limiting](05-tokens-and-rate-limiting.md).
- `ENABLE_GENERATE_PDF=false` removes `/generate-pdf` completely (404).

Start-up prints which endpoints are active, for example:

```
POST /v1/invoices          — one invoice -> PDF (token required)
Tokens + rate limit: Valkey; free: 20/min, paid tokens: disabled (PAID_TOKENS_ENABLED)
```

## Two JSON formats (do not mix them up)

| File | Created by | Content | Accepted by |
| --- | --- | --- | --- |
| `pdfcraft-config.json` | button **Exportieren** | `{ schemaVersion, settings, invoice }` | frontend import and `POST /v1/invoices` |
| `pdfcraft-request.json` | button **API-Request** | `{ template, data, assets }` | `POST /generate-pdf` |

The template is the static file `frontend/src/template/invoice.typ`. The frontend bundles it and sends it with every `/generate-pdf` request; the backend embeds the same file for `/v1`.
