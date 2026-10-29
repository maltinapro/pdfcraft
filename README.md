# PDFCraft — Visual PDF Template Builder

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-1.75%2B-orange?logo=rust)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)

A full-stack **PDF Template Builder** that combines a rich visual editor in the browser with a blazing-fast Rust backend. Design templates with variable placeholders and repeating data blocks, then compile them to publication-quality PDFs via Typst — with no local Typst installation required.

---

## Features

- 🎨 **Visual template designer** powered by [Tiptap](https://tiptap.dev/) — headings, lists, bold/italic/underline, and more
- 🔵 **Variable placeholders** — click to insert `{{kundenname}}`, `{{datum}}`, etc. as styled chips
- 🔁 **Subreports** — repeating data blocks (e.g. invoice line items) rendered as structured template sections
- 📐 **Typst-quality PDF output** via `typst-as-lib` + `typst-pdf` — no local Typst installation needed
- 💉 **Data injection** via [minijinja](https://docs.rs/minijinja/) templating at render time
- 📦 **Vendored Typst packages** — [invoice-pro](https://typst.app/universe/package/invoice-pro/) 0.5.0 and its dependencies ship in the repo; no network access at runtime
- 🧾 **ZUGFeRD / Factur-X ready** — PDFs are exported as PDF/A-3b so invoice-pro can embed the e-invoice XML (`zugferd: "en16931"`, experimental)
- 🔴 **Live template preview** panel shows the generated source as you type

---

## Architecture

```
Browser
  └─ Tiptap Editor
       │  user designs template with variable chips & subreport blocks
       │
       ▼  editor.getJSON()
  template serializer      (frontend/src/lib/tiptapToTypst.ts)
       │  Tiptap JSON → Typst template source with {{ minijinja }} placeholders
       │
       ▼  POST /generate-pdf  { template, data }
  Rust / Axum              (backend/src/main.rs)
       │
       ├─ minijinja → renders template with actual data
       │
       ├─ typst-as-lib + Typst compile rendered source to document
       │
       └─ typst-pdf → PDF bytes
              │
              ▼
          browser download  output.pdf
```

---

## Project Structure

```
pdfcraft/
├── README.md
├── frontend/                         # React + Vite + Tiptap
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx                  # React entry point
│       ├── App.tsx                   # Main application UI
│       ├── App.css                   # Styles
│       ├── extensions/
│       │   ├── VariableNode.ts       # Inline variable placeholder node {{name}}
│       │   ├── SubreportNode.ts      # Block node for repeating data rows
│       │   └── SubreportView.tsx     # React NodeView for subreport visual
│       └── lib/
│           └── tiptapToTypst.ts      # Serializer: Tiptap JSON → Typst string
│
└── backend/                          # Rust (Axum + typst-as-lib + typst-pdf + minijinja)
    ├── Cargo.toml
    ├── src/
    │   └── main.rs
    └── vendor/
        └── typst-packages/           # Vendored @preview packages (invoice-pro 0.5.0, ...)
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

1. Open **http://localhost:5173** in your browser
2. Edit the invoice template in the editor
3. Click **"Export & Generate PDF"** — the PDF is downloaded automatically

---

## How It Works

1. **Design** — The Tiptap editor renders a rich document. Variable chips (`VariableNode`) and subreport blocks (`SubreportNode`) are custom Tiptap extensions rendered as React components.

2. **Serialize** — When the user clicks "Generate PDF", `tiptapToTypst()` walks the Tiptap JSON AST and produces Typst template source. Variable chips become `{{ id }}` minijinja placeholders; subreport blocks become `{% for item in dataSource %}...{% endfor %}` loops for repeated sections.

3. **Send** — The frontend POSTs `{ template, data }` to `POST /generate-pdf` on the Rust backend.

4. **Render** — The Rust handler uses **minijinja** to fill the template placeholders with the supplied JSON data object.

5. **Compile** — The rendered Typst source is compiled to a Typst document via **typst-as-lib** and converted to PDF/A-3b bytes via **typst-pdf** (PDF/A-3b is required to embed ZUGFeRD / Factur-X XML).

6. **Download** — The PDF bytes are returned with `Content-Type: application/pdf`, and the browser triggers a file download.

---

## API Reference

### `POST /generate-pdf`

Compiles a minijinja+Typst template with the supplied data and returns a PDF.

**Request body** (`application/json`):

```json
{
  "template": "#set page(margin: 2.5cm)\n\nHello {{ kundenname }}!",
  "data": {
    "kundenname": "Max Mustermann",
    "datum": "20.03.2026",
    "positionen": [
      { "artikel": "Webentwicklung", "menge": "8h", "preis": "960,00" }
    ]
  }
}
```

**Response** (`200 OK`):

- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="output.pdf"`
- Body: raw PDF bytes

**Error response** (`500 Internal Server Error`):

- Body: plain-text error message describing Typst compilation or template render failure

---

### `GET /health`

Returns server status.

```json
{ "status": "ok" }
```

---

## Extending

### Add a new variable

1. Add an entry to the `VARIABLES` array in `frontend/src/App.tsx`:
   ```ts
   { id: 'lieferadresse', label: 'Lieferadresse' }
   ```
2. The variable is now available in the sidebar. The backend data object must include the matching key.

### Add a new subreport style

1. Edit `frontend/src/lib/tiptapToTypst.ts` in the `subreport` case.
2. Adjust how row content is emitted inside the `{% for item in dataSource %}` loop.
3. Edit `SubreportView.tsx` to reflect the new structure visually in the editor.

### Add math support

Install `@tiptap/extension-mathematics` and add it to the extensions array in `App.tsx`. The Typst serializer already handles `inlineMath` and `blockMath` nodes and emits Typst math blocks.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend framework | [React 18](https://react.dev/) + [Vite](https://vitejs.dev/) |
| Rich text editor | [Tiptap 2](https://tiptap.dev/) (ProseMirror-based) |
| Typst serializer | Custom `tiptapToTypst.ts` |
| HTTP server | [Axum 0.7](https://docs.rs/axum/) |
| Async runtime | [Tokio](https://tokio.rs/) |
| Templating | [minijinja 2](https://docs.rs/minijinja/) |
| PDF backend | [typst-as-lib](https://crates.io/crates/typst-as-lib) + [typst-pdf](https://crates.io/crates/typst-pdf) |
| Invoice template | [invoice-pro 0.5.0](https://typst.app/universe/package/invoice-pro/) (vendored) |
| CORS | [tower-http](https://docs.rs/tower-http/) |

---

## License

MIT © 2026 PDFCraft contributors
