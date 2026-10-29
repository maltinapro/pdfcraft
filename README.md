# PDFCraft — Visual PDF Template Builder

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-1.75%2B-orange?logo=rust)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)

A full-stack **PDF Template Builder** that combines a simple form-based invoice configurator in the browser with a blazing-fast Rust backend. Fill in your invoice data and compile it on a fixed invoice template to publication-quality PDFs via Typst — with no local Typst installation required.

---

## Features

- 🧾 **Form-based invoice configurator** — fill in invoice, recipient and line items; settings cover logo, company address, bank details, accent color, font, footer and texts
- 🖼️ **Logo upload** (PNG/JPG/SVG, ≤ 300 KB) sent to the backend as a base64 asset
- 💾 **Persistence** — settings and invoice draft are auto-saved in the browser (`localStorage`, versioned `schemaVersion`); export/import as JSON, reset to defaults
- 👀 **Live PDF preview** — debounced re-render via the backend, shown in an iframe
- 📐 **Typst-quality PDF output** via `typst-as-lib` + `typst-pdf` — no local Typst installation needed
- 💉 **Data injection** via [minijinja](https://docs.rs/minijinja/) templating at render time
- 📦 **Vendored Typst packages** — [invoice-pro](https://typst.app/universe/package/invoice-pro/) 0.5.0 and its dependencies ship in the repo; no network access at runtime
- 🧾 **XRechnung profile** — choose `EN 16931` or `XRechnung` as e-invoice profile and enter a seller contact (name, phone) as required by the BR-DE rules
- 🧾 **ZUGFeRD / Factur-X ready** — PDFs are exported as PDF/A-3b so invoice-pro can embed the e-invoice XML (`zugferd: "en16931"`, experimental). The sidebar flags missing mandatory e-invoice data; 0 % items use an explicit tax-exempt category with a configurable reason. Validated with Mustang: embedded XML is EN 16931-valid; the backend adds the Factur-X XMP metadata (`backend/src/facturx.rs`) so PDF-level validators accept the file

---

## Architecture

```
Browser
  └─ Form (Invoice / Settings tabs)
       │  buildRequest() validates + escapes input for Typst string literals
       │
       ▼  POST /generate-pdf  { template, data, assets }
  Rust / Axum              (backend/src/main.rs)
       │  template = static frontend/src/template/invoice.typ
       ├─ minijinja → renders template with data (+ assets.<key> paths)
       ├─ typst-as-lib + Typst compile rendered source
       └─ typst-pdf → PDF/A-3b bytes (embedded ZUGFeRD XML)
              │
              ▼
          iframe preview / download

```

---

## Project Structure

```
pdfcraft/
├── README.md
├── frontend/                         # React + Vite
│   └── src/
│       ├── App.tsx                   # Shell: tabs, debounced preview, download
│       ├── App.css
│       ├── components/               # Field, SettingsForm, InvoiceForm
│       ├── lib/
│       │   ├── types.ts              # Model, defaults, whitelists (fonts, units, tax rates)
│       │   ├── storage.ts            # Versioned localStorage + JSON export/import
│       │   ├── buildRequest.ts       # Validation + Typst escaping → request body
│       │   └── api.ts                # requestPdf()
│       └── template/invoice.typ      # Static invoice-pro template with minijinja placeholders
│
└── backend/                          # Rust (Axum + typst-as-lib + typst-pdf + minijinja)
    ├── Cargo.toml
    ├── src/main.rs                   # Router, Typst engine, POST /generate-pdf
    ├── src/v1.rs                     # POST /v1/invoices[/bulk]: API key, rate limit, ZIP
    ├── src/invoice.rs                # Validation/escaping of the /v1 input (mirrors buildRequest.ts)
    ├── src/config.rs                 # Environment configuration
    ├── src/facturx.rs                # Factur-X XMP post-processing (lopdf)
    └── vendor/typst-packages/        # Vendored @preview packages (invoice-pro 0.5.0, ...)
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| [Node.js](https://nodejs.org/) | 18+ |
| [Rust](https://www.rust-lang.org/tools/install) | 1.75+ |

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/maltinapro/pdfcraft.git
cd pdfcraft
```

### 2. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

The dev server starts at **http://localhost:5173**.

### 3. Start the backend

```bash
cd backend
cargo run
```

The first build compiles Typst-related dependencies — this can take a few minutes. Subsequent builds are fast.

The API server starts at **http://localhost:3000**.

Typst packages (`@preview/...`) are loaded from `backend/vendor/typst-packages` — no internet connection is needed at runtime. Set the environment variable `TYPST_PACKAGE_PATH` to use a different directory. When deploying, copy `vendor/typst-packages` along with the binary. See `backend/vendor/typst-packages/README.md` for how to add or update packages.

### 4. Generate a PDF

1. Open **http://localhost:5173**
2. Fill in the **Settings** tab (company, logo, bank details, design) and the **Invoice** tab (recipient, items)
3. Your input is saved automatically in the browser; use **Exportieren / Importieren** for a JSON backup
4. The preview updates automatically; click **"PDF herunterladen"** to download

---

### Docker

```bash
docker compose up --build   # frontend: http://localhost:8080, backend: http://localhost:3000
```

The backend image is built from the repository root (it embeds `frontend/src/template/invoice.typ`), bundles `vendor/typst-packages` and sets `TYPST_PACKAGE_PATH=/app/typst-packages`. Pass `API_KEYS`, `CORS_ALLOWED_ORIGINS` and `ENABLE_GENERATE_PDF` through the environment (see [Configuration](#configuration)), e.g. `API_KEYS=secret docker compose up --build`. The frontend image is built with `VITE_API_BASE_URL` (build arg in `docker-compose.yml`, default `http://localhost:3000`) — set it to the public backend URL when deploying.

## How It Works

1. **Configure** — The forms edit a typed model (`InvoiceSettings`, `Invoice`).
2. **Build request** — `buildRequest()` whitelists fonts, locales, units, tax rates, colors, numbers and dates, and escapes `\` and `"` (all user data is placed into Typst string literals). The static template is imported with `?raw`.
3. **Render** — The backend renders the template with minijinja, using `data` and, for binary files, `assets.<key>` paths.
4. **Compile** — Typst compiles the result; typst-pdf exports PDF/A-3b so invoice-pro can embed the Factur-X XML.
5. **Preview / download** — The PDF is shown via blob URL in an iframe, or downloaded.

---

## Using the backend directly (REST)

### Where does the template come from?

The template is **not** created by the backend. It is the static file `frontend/src/template/invoice.typ` (Typst + minijinja placeholders such as `{{ settings.sender.name }}`). The frontend bundles it (`?raw` import) and `buildRequest()` in `frontend/src/lib/buildRequest.ts` puts it into every request as the `template` field, together with `data` (validated and escaped form values) and `assets` (logo as base64). The backend only renders and compiles what it receives.

### Two different JSON files

| File | Button | Content | Use |
| --- | --- | --- | --- |
| `pdfcraft-config.json` | **Exportieren** | App configuration `{ schemaVersion, settings, invoice }` (raw form values) | Backup / re-import in the UI. **Not** accepted by the API |
| `pdfcraft-request.json` | **API-Request** | Complete request body `{ template, data, assets }` | Send as-is to `POST /generate-pdf` |

### Generate a PDF from the exported request

```bash
cd backend && cargo run            # or: docker compose up --build
curl -X POST http://localhost:3000/generate-pdf \
  -H 'content-type: application/json' \
  --data @pdfcraft-request.json -o invoice.pdf
```

### Many invoices (bulk)

Export one request, keep `template` and `assets`, and replace `data.invoice` (number, date, recipient, items) per invoice, e.g. with `jq`:

```bash
for n in 1 2 3; do
  jq --arg n "2026-00$n" '.data.invoice.number = $n' pdfcraft-request.json \
    | curl -s -X POST http://localhost:3000/generate-pdf \
        -H 'content-type: application/json' --data @- -o "invoice-$n.pdf"
done
```

Rules for `data`: every text value is inserted into a Typst string literal, so `\` and `"` must be escaped as `\\` and `\"`. Units, tax rates, locale, font and color must be one of the whitelisted values in `frontend/src/lib/types.ts` (the backend does not validate them). Errors come back as JSON (e.g. `typst_compile_error`, status 422).

> `POST /generate-pdf` accepts arbitrary templates and has no authentication. For external customers use the [`/v1` API](#production-api-v1) and set `ENABLE_GENERATE_PDF=false`.

---

## Configuration

All settings are environment variables of the backend:

| Variable | Default | Meaning |
| --- | --- | --- |
| `BIND_ADDR` | `0.0.0.0:3000` | Listen address |
| `API_KEYS` | – | Static comma-separated API keys (simple setups; optional when `DATABASE_URL` is set) |
| `DATABASE_URL` | – | Postgres connection string; API keys are stored there as SHA-256 hashes (table `api_keys` is created automatically). `/v1/*` answers `503` while neither this nor `API_KEYS` is set |
| `REDIS_URL` | – | Redis for a rate limit shared by all instances. Unset or unreachable: per-instance in-memory limit |
| `RATE_LIMIT_PER_MINUTE` | `120` | Default invoices per minute **per API key** (DB keys can override it individually) (token bucket; a bulk request costs one per invoice) |
| `BULK_MAX_INVOICES` | `100` | Maximum invoices per bulk request (must not exceed the rate limit) |
| `MAX_CONCURRENT_COMPILES` | CPU count | Simultaneous Typst compilations (all endpoints) |
| `CORS_ALLOWED_ORIGINS` | any | Comma-separated browser origins, e.g. `https://app.example.com`; `*` or unset = any |
| `ENABLE_GENERATE_PDF` | `true` | `false` removes `POST /generate-pdf` (arbitrary templates) |
| `TYPST_PACKAGE_PATH` | `<backend>/vendor/typst-packages` | Vendored Typst packages |

---

## Production API (`/v1`)

For external customers. The template lives on the server (it is the same `frontend/src/template/invoice.typ`, compiled into the binary), so clients only send invoice data. Input is validated strictly and escaped by the server (`backend/src/invoice.rs`); problems are returned together as `400 validation_error`.

**Authentication:** `Authorization: Bearer <key>` or `X-API-Key: <key>` with one of `API_KEYS`. Missing/invalid: `401`. Over the limit: `429` with `Retry-After` (seconds).

**Body:** the same JSON as the app's config export (`pdfcraft-config.json`: `settings` + `invoice`; extra fields such as `schemaVersion` and item `id` are ignored). Required: `settings.sender.{name,address,city}`, `invoice.{number,date,recipient.{name,address,city},items}`. Allowed values: see `frontend/src/lib/types.ts` (fonts, locales, units, tax rates `19/7/0`, profiles `en16931`/`xrechnung`). Do **not** escape text yourself. The logo is `settings.logo.base64` (max 1 MB decoded).

```bash
# one invoice -> PDF
curl -X POST http://localhost:3000/v1/invoices \
  -H 'Authorization: Bearer secret' -H 'content-type: application/json' \
  --data @pdfcraft-config.json -o invoice.pdf

# many invoices with shared settings -> ZIP of PDFs
curl -X POST http://localhost:3000/v1/invoices/bulk \
  -H 'Authorization: Bearer secret' -H 'content-type: application/json' \
  --data @bulk.json -o invoices.zip
```

`bulk.json` is `{ "settings": { ... }, "invoices": [ { "number": "...", "date": "2026-10-29", "recipient": { ... }, "items": [ ... ] }, ... ] }`. The ZIP contains `invoice-<number>.pdf` per invoice; if one invoice fails nothing is returned and the error names it (`invoices[3]: ...`).

### API keys for customers

Keys live in Postgres (`DATABASE_URL`); only a SHA-256 hash is stored, so a database leak does not reveal keys. Manage them with the backend binary:

```bash
export DATABASE_URL=postgres://user:pass@host/pdfcraft
pdfcraft-backend keys create --customer "ACME GmbH" --limit 300   # prints the key ONCE: pk_...
pdfcraft-backend keys list
pdfcraft-backend keys revoke 3        # or: keys activate 3
```

Give the printed key to the customer (`Authorization: Bearer pk_...`). Lookups are cached for ~30 s, so revocation takes effect within that time. In Docker: `docker compose run --rm backend /app/pdfcraft-backend keys create --customer ACME`.

With `REDIS_URL` set, every instance uses the same token bucket per key (atomic Lua script), so the limit holds no matter which instance a request hits. If Redis is unreachable the instance falls back to its own in-memory limit and logs a warning.

Run the server: `API_KEYS=secret RATE_LIMIT_PER_MINUTE=300 cargo run` (in `backend/`). In production put it behind TLS (reverse proxy), set `CORS_ALLOWED_ORIGINS` and `ENABLE_GENERATE_PDF=false`.

---

## API Reference

### `POST /generate-pdf`

Compiles a minijinja+Typst template with the supplied data and returns a PDF.

**Request body** (`application/json`):

```json
{
  "template": "#set page(margin: 2.5cm)\n\nHello {{ name }}!",
  "data": { "name": "Max Mustermann" },
  "assets": { "logo": "<base64 image bytes>" }
}
```

`assets` is optional (max 8 entries, 1 MB each, keys alphanumeric). Each asset is available in the template as `{{ assets.<key> }}`, a virtual file path usable in `image(...)`; `data` must then be a JSON object. The request body is limited to 2 MB.

**Response** (`200 OK`):

- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="output.pdf"`
- Body: raw PDF bytes

**Error response**: JSON with an error code and details (4xx for invalid payloads/templates, 5xx for compile failures).

---

### `GET /health`

Returns server status.

```json
{ "status": "ok" }
```

---

## Extending

- **New setting / field**: add it to `frontend/src/lib/types.ts`, validate it in `buildRequest.ts` and `backend/src/invoice.rs` (the `/v1` API), add an input in the matching form, and use it in `frontend/src/template/invoice.typ`.
- **New unit or tax rate**: extend `UNITS` / `TAX_RATES` in `types.ts` (units must be invoice-pro `unit.<id>` identifiers).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend framework | [React 18](https://react.dev/) + [Vite](https://vitejs.dev/) |
| Invoice template | Static `invoice.typ` (minijinja + Typst) |
| HTTP server | [Axum 0.7](https://docs.rs/axum/) |
| Async runtime | [Tokio](https://tokio.rs/) |
| Templating | [minijinja 2](https://docs.rs/minijinja/) |
| PDF backend | [typst-as-lib](https://crates.io/crates/typst-as-lib) + [typst-pdf](https://crates.io/crates/typst-pdf) |
| Invoice template | [invoice-pro 0.5.0](https://typst.app/universe/package/invoice-pro/) (vendored from our fork [maltinapro/invoice-pro](https://github.com/maltinapro/invoice-pro), upstream [leonieziechmann/invoice-pro](https://github.com/leonieziechmann/invoice-pro), MIT) |
| CORS | [tower-http](https://docs.rs/tower-http/) |

---

## License

PDFCraft is MIT-licensed. The vendored Typst packages keep their own licenses (see `backend/vendor/typst-packages/**/LICENSE`); invoice-pro is MIT © Leonie Ziechmann.

MIT © 2026 PDFCraft contributors
