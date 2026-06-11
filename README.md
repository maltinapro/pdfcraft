# PDFCraft — Visual PDF Template Builder

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-1.75%2B-orange?logo=rust)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)

A full-stack **PDF Template Builder** that combines a rich visual editor in the browser with a blazing-fast Rust backend. Design templates with variable placeholders and repeating data blocks, then compile them to publication-quality PDFs via LaTeX — all without installing TeX Live.

---

## Features

- 🎨 **Visual template designer** powered by [Tiptap](https://tiptap.dev/) — headings, lists, bold/italic/underline, and more
- 🔵 **Variable placeholders** — click to insert `{{kundenname}}`, `{{datum}}`, etc. as styled chips
- 🔁 **Subreports** — repeating data blocks (e.g. invoice line items) rendered as LaTeX tables
- 📐 **LaTeX-quality PDF output** via [Tectonic](https://tectonic-typesetting.github.io/) — no TeX installation needed
- 💉 **Data injection** via [minijinja](https://docs.rs/minijinja/) templating at render time
- 🔴 **Live LaTeX preview** panel shows the generated LaTeX as you type

---

## Architecture

```
Browser
  └─ Tiptap Editor
       │  user designs template with variable chips & subreport blocks
       │
       ▼  editor.getJSON()
  tiptapToLatex()          (frontend/src/lib/tiptapToLatex.ts)
       │  Tiptap JSON → LaTeX string with {{ minijinja }} placeholders
       │
       ▼  POST /generate-pdf  { template, data }
  Rust / Axum              (backend/src/main.rs)
       │
       ├─ minijinja → renders template with actual data
       │
       └─ tectonic::latex_to_pdf() → PDF bytes
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
│           └── tiptapToLatex.ts      # Serializer: Tiptap JSON → LaTeX string
│
└── backend/                          # Rust (Axum + tectonic + minijinja)
    ├── Cargo.toml
    └── src/
        └── main.rs
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

The first build downloads the tectonic engine — this takes a few minutes. Subsequent builds are fast.

The API server starts at **http://localhost:3000**.

### 4. Generate a PDF

1. Open **http://localhost:5173** in your browser
2. Edit the invoice template in the editor
3. Click **"Export & Generate PDF"** — the PDF is downloaded automatically

---

## How It Works

1. **Design** — The Tiptap editor renders a rich document. Variable chips (`VariableNode`) and subreport blocks (`SubreportNode`) are custom Tiptap extensions rendered as React components.

2. **Serialize** — When the user clicks "Generate PDF", `tiptapToLatex()` walks the Tiptap JSON AST and produces a LaTeX document string. Variable chips become `{{ id }}` minijinja placeholders; subreport blocks become `{% for item in dataSource %}...{% endfor %}` loops wrapping a `\begin{tabular}`.

3. **Send** — The frontend POSTs `{ template, data }` to `POST /generate-pdf` on the Rust backend.

4. **Render** — The Rust handler uses **minijinja** to fill the template placeholders with the supplied JSON data object.

5. **Compile** — The rendered LaTeX string is compiled to PDF bytes by **tectonic** (a self-contained LaTeX engine; no TeX Live needed).

6. **Download** — The PDF bytes are returned with `Content-Type: application/pdf`, and the browser triggers a file download.

---

## API Reference

### `POST /generate-pdf`

Compiles a minijinja+LaTeX template with the supplied data and returns a PDF.

**Request body** (`application/json`):

```json
{
  "template": "\\documentclass{article}\\begin{document}Hello {{ kundenname }}!\\end{document}",
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

- Body: plain-text error message describing the LaTeX compilation or template render failure

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

1. Edit `frontend/src/lib/tiptapToLatex.ts` in the `subreport` case.
2. Customize the `\begin{tabular}` column specification or add `\toprule`/`\midrule` header rows.
3. Edit `SubreportView.tsx` to reflect the new structure visually in the editor.

### Add math support

Install `@tiptap/extension-mathematics` and add it to the extensions array in `App.tsx`. The LaTeX serializer already handles `inlineMath` → `$...$` and `blockMath` → `\[...\]`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend framework | [React 18](https://react.dev/) + [Vite](https://vitejs.dev/) |
| Rich text editor | [Tiptap 2](https://tiptap.dev/) (ProseMirror-based) |
| LaTeX serializer | Custom `tiptapToLatex.ts` |
| HTTP server | [Axum 0.7](https://docs.rs/axum/) |
| Async runtime | [Tokio](https://tokio.rs/) |
| Templating | [minijinja 2](https://docs.rs/minijinja/) |
| LaTeX engine | [Tectonic 0.15](https://tectonic-typesetting.github.io/) |
| CORS | [tower-http](https://docs.rs/tower-http/) |

---

## License

MIT © 2026 PDFCraft contributors
