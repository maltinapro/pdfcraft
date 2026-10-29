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
- 🧾 **ZUGFeRD / Factur-X ready** — PDFs are exported as PDF/A-3b so invoice-pro can embed the e-invoice XML (`zugferd: "en16931"`, experimental). The sidebar flags missing mandatory e-invoice data; 0 % items use an explicit tax-exempt category with a configurable reason. Validated with Mustang: embedded XML is EN 16931-valid; the Factur-X XMP metadata is not written yet (known limitation)

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
    ├── src/main.rs
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

## How It Works

1. **Configure** — The forms edit a typed model (`InvoiceSettings`, `Invoice`).
2. **Build request** — `buildRequest()` whitelists fonts, locales, units, tax rates, colors, numbers and dates, and escapes `\` and `"` (all user data is placed into Typst string literals). The static template is imported with `?raw`.
3. **Render** — The backend renders the template with minijinja, using `data` and, for binary files, `assets.<key>` paths.
4. **Compile** — Typst compiles the result; typst-pdf exports PDF/A-3b so invoice-pro can embed the Factur-X XML.
5. **Preview / download** — The PDF is shown via blob URL in an iframe, or downloaded.

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

- **New setting / field**: add it to `frontend/src/lib/types.ts`, validate it in `buildRequest.ts`, add an input in the matching form, and use it in `frontend/src/template/invoice.typ`.
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
| Invoice template | [invoice-pro 0.5.0](https://typst.app/universe/package/invoice-pro/) (vendored) |
| CORS | [tower-http](https://docs.rs/tower-http/) |

---

## License

MIT © 2026 PDFCraft contributors
