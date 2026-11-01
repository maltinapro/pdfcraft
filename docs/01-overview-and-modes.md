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
| `POST /v1/free-token` | Anubis pass | the frontend | Issues a free token, see [Free Token and Anubis](11-free-token-and-anubis.md) |
| `POST /v1/invoices` | token | frontend and customer systems | One invoice → PDF. Fixed server-side template, strict validation; free tokens add the "Entwurf" watermark |
| `POST /v1/invoices/bulk` | token | customer systems | Many invoices → ZIP of PDFs |

Rule of thumb: **everything goes through `/v1`: the frontend with a free token, customers with a purchased token.** Never put a purchased token into the frontend: everything in a browser bundle is public. The demo frontend only holds a short-lived, rate-limited free token.

## Run modes

| Mode | Frontend | `/v1` | Tokens | Typical use |
| --- | --- | --- | --- | --- |
| **A. Local dev** | `npm run dev` with `VITE_API_TOKEN` | on (needs `VALKEY_URL`) | token from the CLI | developing the UI |
| **B. Local API test** | optional | on | Valkey, tokens from the CLI | testing `/v1`, bulk, limits with curl |
| **C. Demo** | public behind Anubis | on | free tokens | showing prospects the configurator |
| **D. Production** | not needed (or separate) | on | purchased tokens (`PAID_TOKENS_ENABLED=true`) | customers integrating the API |

How the backend decides:

- `/v1` answers `503 store_unavailable` while `VALKEY_URL` is unset or Valkey is unreachable.
- Tokens and rate limits always live in Valkey; see [Tokens and Rate Limiting](05-tokens-and-rate-limiting.md).
- The old template-based `/generate-pdf` endpoint no longer exists.

Start-up prints which endpoints are active, for example:

```
POST /v1/invoices          — one invoice -> PDF (token required)
Tokens + rate limit: Valkey; free: 20/min, paid tokens: disabled (PAID_TOKENS_ENABLED)
```

## Config JSON format

| File | Created by | Content | Accepted by |
| --- | --- | --- | --- |
| `pdfcraft-config.json` | button **Exportieren** | `{ schemaVersion, settings, invoice }` | frontend import and `POST /v1/invoices` |

The frontend sends `{ settings, invoice }` (the same shape) to `/v1/invoices`. The template is the static file `frontend/src/template/invoice.typ`, embedded into the backend.
