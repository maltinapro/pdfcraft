# PDFCraft — Visual PDF Template Builder

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-1.75%2B-orange?logo=rust)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)

A full-stack **PDF Template Builder** that combines a simple form-based invoice configurator in the browser with a blazing-fast Rust backend. Fill in your invoice data and compile it on a fixed invoice template to publication-quality PDFs via Typst — with no local Typst installation required.

**Live demo:** [digitalrechnung.jetzt](https://digitalrechnung.jetzt) — try the [invoice configurator](https://digitalrechnung.jetzt/app/) without a local installation. Please use sample data only.

## Features

- 🧾 **Form-based invoice configurator** — fill in invoice, recipient and line items; settings cover logo, company address, bank details, accent color, font, footer and texts
- 🖼️ **Logo upload** (PNG/JPG/SVG, ≤ 300 KB) sent to the backend as a base64 asset
- 💾 **Persistence** — settings and invoice draft are auto-saved in the browser (`localStorage`, versioned `schemaVersion`); export/import as JSON, reset to defaults
- 👀 **Live PDF preview** — debounced re-render via the backend, shown in an iframe
- 📐 **Typst-quality PDF output** via `typst-as-lib` + `typst-pdf` — no local Typst installation needed
- 💉 **Data injection** via [minijinja](https://docs.rs/minijinja/) templating at render time
- 📦 **Vendored Typst packages** — [invoice-pro](https://typst.app/universe/package/invoice-pro/) 0.5.0 and its dependencies ship in the repo; no network access at runtime
- 🧾 **ZUGFeRD / Factur-X and XRechnung** — PDF/A-3b output with embedded EN 16931 or XRechnung XML (validated with Mustang), plus a sidebar that flags missing mandatory data

## Quick Start

Requires [Node.js](https://nodejs.org/) 18+ and [Rust](https://www.rust-lang.org/tools/install) 1.75+.

```bash
git clone https://github.com/maltinapro/pdfcraft.git && cd pdfcraft

# Terminal 1: backend on http://localhost:3000 (first build takes a few minutes)
cd backend && cargo run

# Terminal 2: frontend on http://localhost:5173 (landing page; the app is at /app/)
cd frontend && npm install && npm run dev
```

Or with Docker: `docker compose up --build` (landing page http://localhost:8080, app http://localhost:8080/app/, backend http://localhost:3000).

Open the frontend, fill in **Settings** and **Invoice**, and download the PDF. Input is saved in the browser; use **Exportieren / Importieren** for a JSON backup. The UI fetches a short-lived free token itself (Anubis challenge, PDFs carry an "Entwurf" watermark).

## Architecture

```
Browser form ──POST /v1/invoices (free token)──> Rust / Axum ── minijinja ── Typst ──> PDF/A-3b (+ ZUGFeRD XML)
Customer system ──POST /v1/invoices (purchased token)──> same engine, no watermark
```

Details: [Architecture and Extending](docs/10-architecture-and-extending.md).

## API at a glance

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `POST /v1/free-token` | Anubis pass | Free token for the demo frontend |
| `POST /v1/invoices` | token | One invoice → PDF |
| `POST /v1/invoices/bulk` | token | Many invoices → ZIP |
| `GET /health` | none | Status |

```bash
curl -X POST http://localhost:3000/v1/invoices \
  -H 'Authorization: Bearer <key>' -H 'content-type: application/json' \
  --data @pdfcraft-config.json -o invoice.pdf
```

Full reference: [API Reference](docs/09-api-reference.md).

## Documentation

| Guide | Content |
| --- | --- |
| [Overview and Run Modes](docs/01-overview-and-modes.md) | Components and modes (dev, demo, production) |
| [Local Development](docs/02-local-development.md) | Run and test from source |
| [Docker (Local)](docs/03-docker-local.md) | Compose, Valkey |
| [Configuration](docs/04-configuration.md) | All environment variables |
| [Tokens and Rate Limiting](docs/05-tokens-and-rate-limiting.md) | Issue and manage customer keys |
| [Production](docs/06-production.md) | Deploying the `/v1` API |
| [Demo System](docs/07-demo-system.md) | Showing the configurator to prospects |
| [Kubernetes / Helm](docs/08-kubernetes-helm-outlook.md) | Demo chart in `deploy/helm/pdfcraft`; production chart planned |
| [API Reference](docs/09-api-reference.md) | Endpoints, bodies, examples |
| [Architecture and Extending](docs/10-architecture-and-extending.md) | Structure, how it works, adding fields |
| [Free Token and Anubis](docs/11-free-token-and-anubis.md) | Free tokens, Anubis, watermark |

## Tech Stack

React + Vite, Rust + Axum, minijinja, Typst (`typst-as-lib`, `typst-pdf`), [invoice-pro](https://typst.app/universe/package/invoice-pro/) (our [fork](https://github.com/maltinapro/invoice-pro)), Valkey.

## License

PDFCraft is MIT-licensed. The vendored Typst packages keep their own licenses (see `backend/vendor/typst-packages/**/LICENSE`); invoice-pro is MIT © Leonie Ziechmann.

MIT © 2026 PDFCraft contributors
