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
3. **Prepare**: `backend/src/einvoice.rs` computes amounts (fixed-point, cents, half away from zero) and display texts, and generates the Factur-X / XRechnung XML (CII, EN 16931). Any problem (missing VAT id, invalid IBAN, XRechnung gaps ...) turns the attachment into `invoice-draft.xml`.
4. **Render**: the backend renders its embedded template with minijinja, using the prepared data; the logo is `assets.logo`, the XML is `assets.xml`.
5. **Compile**: Typst only lays out the data (no template package, ~8 ms); typst-pdf exports PDF/A-3b and the template attaches the XML with `pdf.attach`. `backend/src/facturx.rs` adds the Factur-X XMP metadata.
6. **Preview / download**: the PDF is shown via blob URL in an iframe, or downloaded.

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
│       │   ├── theme.ts              # Light/dark theme (system default, manual override)
│       │   ├── validate.ts           # E-invoice issues shown in the sidebar
│       │   └── api.ts                # free token handling + requestPdf() (POST /v1/invoices)
│       └── template/invoice.typ      # Lean static Typst template with minijinja placeholders
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
    └── vendor/typst-packages/        # Vendored @preview packages (sepay, ibanator, rustycure)
```

## Vendored Typst packages

Packages are loaded from `backend/vendor/typst-packages`, so no network access is needed at runtime. Set `TYPST_PACKAGE_PATH` to use another directory; when deploying, ship the directory with the binary (the Docker image does). See `backend/vendor/typst-packages/README.md` for adding or updating packages.

The invoice template no longer uses invoice-pro/loom (they cost ~65 ms per PDF); only `sepay` (EPC QR) is imported. Old invoice-pro forks: [maltinapro/invoice-pro](https://github.com/maltinapro/invoice-pro).

## Customizing the invoice template

The invoice is a single Typst file: `frontend/src/template/invoice.typ` (the backend embeds it with `include_str!` in `backend/src/v1.rs`; there is no copy in `backend/`). It is rendered with minijinja, then compiled by Typst. Rebuild the backend after editing it.

**Data available in the template** (see `backend/src/einvoice.rs::prepare` and `v1.rs::document`):
- `settings.*` (checked settings: `accentColor`, `font`, `locale`, `footer`, `intro`, `closing`, `watermark`, sender data ...) and `invoice.*` (number, recipient, items).
- Ready-made display strings from Rust: `invoice.items[*].pos/qty/price/tax/net`, `invoice.dateText`, `invoice.totals` (`net`, `gross`, `taxes[]`, `exempt`).
- `pay.*` (`sum`, `days`, `iban`, `bic`, `qr`, `amount`, `place`), `einvoice.*` (`file`, `relationship`, `description`) and the assets `assets.logo` / `assets.xml`.

**Rules**
- Interpolate user text only as Typst string literals (`#"{{ x }}"` in content mode, `"{{ x }}"` in code mode); never as markup/code. The backend escapes `\` and `"` only.
- Do the math and number formatting in Rust, not in Typst. Typst layout is what costs time; keep loops, `context`, `query`, state and heavy packages out (the old invoice-pro/loom template needed ~65 ms, this one ~8 ms).
- Keep the `#pdf.attach(...)` call: it embeds the Factur-X / XRechnung XML. The XML itself comes from `einvoice.rs`, not from the template.
- New data: compute it in `einvoice.rs` (add to `extra` or the invoice JSON) and use it here.

**Taking something from the invoice-pro fork** ([maltinapro/invoice-pro](https://github.com/maltinapro/invoice-pro), upstream [leonieziechmann/invoice-pro](https://github.com/leonieziechmann/invoice-pro), MIT; it is no longer vendored): look at the fork's `src/` for layout ideas, copy the layout code into `invoice.typ` and replace its data access (`loom` / model values) with the fields above. Keep the MIT copyright notice (© Leonie Ziechmann) if you copy substantial code, e.g. in a comment or in `README.md`. Do not re-add the package as a dependency unless you accept the performance cost.

**Checking a change**: `cd backend && cargo test --release`, start the backend (`cargo run --release`; the warm-up compiles the real template and fails loudly on errors), generate a PDF via the app or `/v1/invoices`, and for e-invoice changes validate it with Mustang (`java -jar Mustang-CLI-2.26.0.jar --action validate --source invoice.pdf`).

## Extending

- **New setting / field**: add it to `frontend/src/lib/types.ts`, validate it in `backend/src/invoice.rs`, add an input in the matching form, and handle it in `backend/src/einvoice.rs` (totals, XML) if it affects amounts or the e-invoice, and use it in `frontend/src/template/invoice.typ`.
- **New unit or tax rate**: extend `UNITS` / `TAX_RATES` in `types.ts` (also add the unit label/UN code in `einvoice.rs` and the template).
- **Config schema change**: bump `SCHEMA_VERSION` in `storage.ts` and add a migration in `parseConfig`.
- **Rule**: do not add caches of rendered templates or PDFs; customer data must not be retained between requests.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | [React 18](https://react.dev/) + [Vite](https://vitejs.dev/) |
| HTTP server | [Axum](https://docs.rs/axum/) on [Tokio](https://tokio.rs/) |
| Templating | [minijinja 2](https://docs.rs/minijinja/) |
| PDF | [typst-as-lib](https://crates.io/crates/typst-as-lib) + [typst-pdf](https://crates.io/crates/typst-pdf) |
| Invoice template | Own lean Typst template + `einvoice.rs` (XML) |
| Keys / rate limit | Valkey (`redis` crate) |
| CORS | [tower-http](https://docs.rs/tower-http/) |
