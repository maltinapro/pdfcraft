# 10. Architecture and Extending

## Architecture

```
Browser
  └─ Form (Invoice / Settings tabs)
       │  free token (Anubis → POST /v1/free-token), kept in localStorage
       │
       ▼  POST /v1/invoices  { settings, invoice }  + Bearer token
  Rust / Axum              (backend/src/v1.rs, invoice.rs)
       │  validates + escapes input; template = static frontend/src/template/invoice.typ
       ├─ minijinja → renders template with the checked data (+ watermark for free tokens)
       ├─ typst-as-lib + Typst compile rendered source
       └─ typst-pdf → PDF/A-3b bytes (embedded ZUGFeRD XML)
              │
              ▼
          iframe preview / download
```

## How it works

1. **Configure**: the forms edit a typed model (`InvoiceSettings`, `Invoice`).
2. **Request**: `requestPdf()` in `api.ts` sends `{settings, invoice}` with the free token. The backend (`invoice.rs`) whitelists fonts, locales, units, tax rates, colors, numbers and dates, and escapes `\` and `"` (all user data goes into Typst string literals).
3. **Render**: the backend renders its embedded template with minijinja, using the checked data and, for the logo, an `assets.logo` path.
4. **Compile**: Typst compiles the result; typst-pdf exports PDF/A-3b so invoice-pro can embed the Factur-X / XRechnung XML. `backend/src/facturx.rs` adds the Factur-X XMP metadata.
5. **Preview / download**: the PDF is shown via blob URL in an iframe, or downloaded.

Customer systems skip step 1 and send the same JSON with a purchased token.

## Project structure

```
pdfcraft/
├── README.md
├── docs/                             # Guides (this folder)
├── docker-compose.yml
├── frontend/                         # React + Vite
│   └── src/
│       ├── App.tsx                   # Shell: tabs, debounced preview, download
│       ├── components/               # Field, SettingsForm, InvoiceForm
│       ├── lib/
│       │   ├── types.ts              # Model, defaults, whitelists (fonts, units, tax rates)
│       │   ├── storage.ts            # Versioned localStorage + JSON export/import
│       │   ├── validate.ts           # E-invoice issues shown in the sidebar
│       │   └── api.ts                # free token handling + requestPdf() (POST /v1/invoices)
│       └── template/invoice.typ      # Static invoice-pro template with minijinja placeholders
│
└── backend/                          # Rust (Axum + typst-as-lib + typst-pdf + minijinja)
    ├── Cargo.toml
    ├── src/main.rs                   # Router, Typst engine
    ├── src/free.rs                   # POST /v1/free-token (Anubis cookie check), anubis-keygen
    ├── src/v1.rs                     # POST /v1/invoices[/bulk]: token auth, rate limit, ZIP
    ├── src/invoice.rs                # Validation/escaping of the /v1 input
    ├── src/store.rs                  # tokens + rate limit (Valkey), `tokens` CLI
    ├── src/config.rs                 # Environment configuration
    ├── src/facturx.rs                # Factur-X XMP post-processing (lopdf)
    └── vendor/typst-packages/        # Vendored @preview packages (invoice-pro, ...)
```

## Vendored Typst packages

Packages are loaded from `backend/vendor/typst-packages`, so no network access is needed at runtime. Set `TYPST_PACKAGE_PATH` to use another directory; when deploying, ship the directory with the binary (the Docker image does). See `backend/vendor/typst-packages/README.md` for adding or updating packages.

`invoice-pro` is vendored from our fork [maltinapro/invoice-pro](https://github.com/maltinapro/invoice-pro) (upstream [leonieziechmann/invoice-pro](https://github.com/leonieziechmann/invoice-pro), MIT); see `FORK.md` in the vendored copy.

## Extending

- **New setting / field**: add it to `frontend/src/lib/types.ts`, validate it in `backend/src/invoice.rs`, add an input in the matching form, and use it in `frontend/src/template/invoice.typ`.
- **New unit or tax rate**: extend `UNITS` / `TAX_RATES` in `types.ts` (units must be invoice-pro `unit.<id>` identifiers).
- **Config schema change**: bump `SCHEMA_VERSION` in `storage.ts` and add a migration in `parseConfig`.
- **Rule**: do not add caches of rendered templates or PDFs; customer data must not be retained between requests.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | [React 18](https://react.dev/) + [Vite](https://vitejs.dev/) |
| HTTP server | [Axum](https://docs.rs/axum/) on [Tokio](https://tokio.rs/) |
| Templating | [minijinja 2](https://docs.rs/minijinja/) |
| PDF | [typst-as-lib](https://crates.io/crates/typst-as-lib) + [typst-pdf](https://crates.io/crates/typst-pdf) |
| Invoice template | [invoice-pro](https://typst.app/universe/package/invoice-pro/) (fork) |
| Keys / rate limit | Valkey (`redis` crate) |
| CORS | [tower-http](https://docs.rs/tower-http/) |
