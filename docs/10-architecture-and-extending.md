# 10. Architecture and Extending

## Architecture

```
Browser
  └─ PaperEditor from @maltinapro/pdfcraft-editor (six document types, four guided zones; the app supplies the adapter)
       │  free token (Anubis → POST /v1/free-token), kept in localStorage
       │
       ▼  POST /v1/invoices  { settings, invoice }  + Bearer token
  Rust / Axum              (backend/src/v1.rs, invoice.rs, documents.rs)
       │  validates + escapes input; uses static Typst templates
       ├─ minijinja → renders template with the checked data (+ watermark for free tokens)
       ├─ typst-as-lib + Typst compile rendered source
       └─ typst-pdf → PDF/A-3b bytes (embedded ZUGFeRD XML)
              │
              ▼
          pdf.js canvas preview / download
```

The request arrow illustrates the invoice path; the other document types use `POST /v1/documents`. Only browser preview requests add `?zones=1`.

## How it works

1. **Configure**: `PaperEditor` (package `@maltinapro/pdfcraft-editor`, see [Editor package](#editor-package)) edits the selected document through four guided zones. Invoice and document forms update their typed models (`InvoiceSettings`, `Invoice`, or the corresponding document type); the app stores the drafts in browser storage (the package itself touches no storage).
2. **Request**: `api.ts` sends invoice or document data with the free token. Preview requests add `?zones=1`; the flag affects only preview geometry and does not change the ordinary API contract. The backend allow-lists supported values and escapes `\` and `"` (all user data goes into Typst string literals).
3. **Prepare**: `backend/src/einvoice.rs` computes amounts (fixed-point, cents, half away from zero) and display texts, and generates the Factur-X / XRechnung XML (CII, EN 16931). Any problem (missing VAT id, invalid IBAN, XRechnung gaps ...) turns the attachment into `invoice-draft.xml`.
4. **Render**: the backend renders its embedded template with minijinja, using the prepared data; the logo is `assets.logo`, the XML is `assets.xml`.
5. **Compile**: Typst only lays out the data (no template package, ~8 ms); typst-pdf exports PDF/A-3b and the template attaches the XML with `pdf.attach`. `backend/src/facturx.rs` adds the Factur-X XMP metadata.
6. **Preview / download**: preview requests ask for zone 3/4 geometry using `?zones=1`; the backend returns it in `X-Pdfcraft-Zones` without changing ordinary API responses. The frontend displays the PDF blob on a pdf.js canvas, draws clickable zone outlines and opens the corresponding fields when a zone is selected. On compact screens a Form/Preview tab switch shows either the stepper form or the paper, and tapping a zone on the paper returns to the form; on wide screens a splitter adjusts the form/preview balance. Final PDFs can be downloaded and entered in the local archive.

The shared `settings.design` choice is `classic` by default (including for older saved configs) or `modern-minimal`. Both variants are conditional styling in the same invoice and shared document templates, so the address field, reference line and DIN 5008 marks stay fixed; the design is part of config backups and issue-time archive snapshots. The settings form shows static previews rendered from the actual templates.

Customer systems skip step 1 and send the same JSON with a purchased token.

## Project structure

```
pdfcraft/
├── README.md
├── docs/                             # Guides (this folder)
├── docker-compose.yml
├── frontend/                         # React + Vite
│   ├── public/                       # Logo (logo.svg), favicons, icons, og-image, robots.txt, sitemap.xml
│   ├── partials/site-{header,footer}.html  # Header and footer shared by all static pages (`<!-- site-header -->`, `<!-- site-footer -->`; `.en.html` variants)
│   ├── <slug>/index.html             # Static SEO pages (zugferd-rechnung-erstellen, xrechnung-generator, stornorechnung-gutschrift-e-rechnung, e-rechnungspflicht, zugferd-xrechnung-pruefen)
│   ├── packages/design/              # @maltinapro/pdfcraft-design (npm workspace, MIT): tokens.css, ui.css, components (Button, Card, Banner, Menu, ...), icons, theme; see its README + CHANGELOG
│   ├── packages/editor/              # @maltinapro/pdfcraft-editor (npm workspace, MIT): PaperEditor, zone model, forms, preview, adapter interface; see its README
│   │   └── src/{adapter.tsx,index.ts,base.css,editor.css,components/,lib/}  # lib/: types, documents (DOC_SPECS, ZONES), validate, apiErrors, i18n, catalog, parse, ...
│   └── src/
│       ├── App.tsx                   # Hash routes (`#/`, `#/offer`, `#/documents`, `#/contacts` / `#/articles`, `#/data`, `#/sender` = invoice with the sender zone open, ...), shared settings, drafts
│       ├── components/               # Dashboard (Start: invoice card, type grid, checklist, latest documents), DocumentsPage + ArchiveList (Belege: search, filter chips, row menu, selection mode), MasterDataPage (Kunden/Artikel tabs), MasterDataPickers (recipient/article pickers in the forms), DataPage (backup/restore/reset), MorePage, BuyPage, ViewerPage (all on `components/ui/` + `pages.css`; `lib/archiveFilter.ts`, `lib/onboarding.ts`), `PaperEditor` lives in the package,
│       ├── lib/
│       │   ├── router.ts             # Tiny hash router
│       │   ├── storage.ts            # Versioned localStorage + JSON export/import
│       │   ├── editorAdapter.ts      # The app's EditorAdapter for the package (render via api.ts, master data, postage, XML)
│       │   ├── drafts.ts, language.ts # Drafts (`pdfcraft.documents`) and UI language (`pdfcraft.lang`) persistence the package leaves to the host
│       │   ├── backup.ts             # Complete backup file (`BACKUP_VERSION` 2: config + drafts + archive + master data), last-backup reminder
│       │   ├── masterData.ts         # Saved recipients and articles (`localStorage` key `pdfcraft.masterData`, `masterDataVersion` 1), strict parser, merge/seed helpers
│       │   ├── einvoice/             # E-invoice viewer: extract.ts (PDF/XML -> XML), xml.ts, parse.ts (CII + UBL -> view model), check.ts (plausibility checks), format.ts, testdata/
│       │   └── api.ts                # free token handling + requestPdf() / requestDocument()
│       └── template/                 # layout.typ (shared layout + design tokens) + invoice/credit-note/offer/order/delivery-note/letter/dunning/report.typ
│
└── backend/                          # Rust (Axum + typst-as-lib + typst-pdf + minijinja)
    ├── Cargo.toml
    ├── src/main.rs                   # Router, Typst engine
    ├── src/free.rs                   # POST /v1/free-token (Anubis cookie check), anubis-keygen
    ├── src/v1.rs                     # /v1 handlers (invoices, documents, bulk ZIP): token auth, rate limit, parallel rendering
    ├── src/v1/warm_up.rs             # start-up compile of sample documents (fonts, templates)
    ├── src/invoice.rs                # Validation/escaping of the /v1 input
    ├── src/documents.rs              # POST /v1/documents[/bulk]: types, validation, template assembly, credit-note XML
    ├── src/report.rs                 # report type (`report`): typed tables, groups, subtotals, totals in fixed point, limits
    ├── src/dunning.rs                # dunning letter (`dunning` type): invoices, fees, interest, totals in cents, audit record
    ├── src/interest.rs               # § 288 BGB default interest: day-exact split over base-rate periods (table `src/data/base-rates.json`, env `BASE_RATES`)
    ├── src/internetmarke.rs          # Deutsche Post stamps (optional): /v1/postage/* (products, stamps, bulk, recover), test API for free tokens, nothing stored
    ├── src/postage.rs                # stamp PNG validation and 1:1 sizing for the templates
    ├── src/store.rs                  # tokens + rate limit (Valkey), `tokens` CLI
    ├── src/config.rs                 # Environment configuration
    ├── src/facturx.rs                # Factur-X XMP post-processing (lopdf)
    └── vendor/typst-packages/        # Vendored @preview packages (sepay, ibanator, rustycure)
```

## Editor package

The paper-first editor is its own package, `@maltinapro/pdfcraft-editor` (`frontend/packages/editor`, an npm workspace; MIT; versioned by git tags `editor-vX.Y.Z` and published to GitHub Packages by `.github/workflows/release-editor-package.yml`). The app uses it like any other host:

- `PaperEditor` (lazy, its own chunk) gets the controlled `settings` and `document`, an `EditorAdapter` and optional slots (`header`, `banner`, `renderDownloaded`). The package keeps **no storage and calls no API itself**; everything comes through the adapter: `render` (required; PDF + zone rectangles), `customers`/`articles` (list/subscribe/save), `postage`, `extractXml`, `reportError`. The app's adapter is `frontend/src/lib/editorAdapter.ts`; the interface is documented in `frontend/packages/editor/README.md` and typed in `adapter.tsx`.
- The package reads the document model (types, `DOC_SPECS`, `ZONES`, validation, `apiErrors`) from its own `lib/`; the app imports them from `@maltinapro/pdfcraft-editor`. The UI language is held in memory by the package (`setLang`/`useLang`/`tr`), the app persists it (`lib/language.ts`).
- CSS: the host supplies the design tokens (`@maltinapro/pdfcraft-design/tokens.css`) and the base layout; the package ships `base.css` (eager) and `editor.css` (with the lazy editor).
- `src/boundary.test.ts` fails when the package imports from outside `src/` (other than `react`, `react-dom`, `pdfjs-dist`) or uses `localStorage`/`sessionStorage`/`indexedDB`/`fetch`. `npm run budget` limits the `PaperEditor-*` chunk.
- The Dockerfile copies `packages/design/package.json` and `packages/editor/package.json` before `npm ci` (the workspaces are linked into `node_modules`).
- New form fields, zones or validation rules go into the package (`frontend/packages/editor/src/`); new data sources for the editor become optional adapter members, never storage access inside the package. A release is a version bump in the package's `package.json` plus the tag.

## Design package

The design system is the package `@maltinapro/pdfcraft-design` (`frontend/packages/design`, an npm workspace; MIT; versioned by git tags `design-vX.Y.Z` and published to GitHub Packages by `.github/workflows/release-design-package.yml`; changes are listed in its `CHANGELOG.md`). The app and `@maltinapro/pdfcraft-editor` consume it like any other host would (FediFinance uses the same package instead of a copy with a drift check):

- `tokens.css` (Material Design 3 roles, light/dark, high contrast, forced colors; `@import '@maltinapro/pdfcraft-design/tokens.css'` in `App.css`, `site.css`, `viewer.css`), `ui.css` (the `.ui-*` styles; loaded by the package barrel) and the components `Banner`, `BottomSheet`, `Button`, `ButtonLink`, `Card`, `Chip`/`FilterChip`, `Dialog`, `EmptyState`, `Menu`/`MenuItem`, `SegmentedButton`, `Snackbar`, `AppIcon`/`DocIcon`/`StatusIcon` and the theme preference (`applyTheme`, `storedTheme`, `systemTheme`).
- The package has no i18n (texts such as `Banner`'s `dismissLabel` are passed in by the caller) and no dependency on the app or on the editor; `src/boundary.test.ts` allows only `react`/`react-dom` imports and `localStorage` only in `theme.ts`.
- Tests: `tokens.test.mjs` is the **contrast test** (AA text contrast and UI boundaries for light, dark and both high-contrast variants), `theme.test.mjs`, `components.test.tsx`. Run `cd frontend && npm test`.
- Visual check after a change: `npm run build` and `npm run screenshots -- --production`; `npm run budget` limits the design CSS chunk (`src-*.css`, named after the package's `src/` folder).
- A change to a token, a component or an icon needs an entry in `frontend/packages/design/CHANGELOG.md`; a release is a version bump in the package's `package.json` plus the tag.

## E-invoice viewer and checker

Route `#/viewer` (`components/ViewerPage.tsx`, public, no token) reads a received e-invoice **entirely in the browser**; there is no endpoint and nothing is uploaded or stored.

1. `lib/einvoice/extract.ts`: a PDF is opened with `pdfjs-dist` (loaded lazily into its own chunk, shared with the PDF preview) and the XML attachment is picked (`factur-x.xml`, `zugferd-invoice.xml`, `xrechnung.xml`, case-insensitive, otherwise the first `.xml`); a plain `.xml` is used as is. Limits: PDF 20 MB, XML 5 MB; errors (empty, too large, unsupported, unreadable/encrypted PDF, no XML) have codes that `ViewerPage` shows as text. `pdfjs-dist` was chosen over `pdf-lib` because it is already a dependency (no second PDF library in the bundle).
2. `lib/einvoice/xml.ts`: small dependency-free XML reader (local names only; DOCTYPE and custom entities are never expanded), so it runs in Node tests and cannot be hit by entity expansion.
3. `lib/einvoice/parse.ts`: maps CII (`CrossIndustryInvoice`: ZUGFeRD 2, Factur-X, XRechnung) and UBL (`Invoice`, `CreditNote`) to one view model (`InvoiceView`: parties, references, items, allowances/charges, tax breakdown, totals, payment means, notes). ZUGFeRD 1.x is rejected with its own message.
4. `lib/einvoice/check.ts`: `runChecks()` returns the plausibility checks (mandatory header/party/line fields, line amount = quantity x price, line sum, net total, tax basis and amount per category/rate, total tax, gross total, amount due, tax categories with exemption reason, payment means with IBAN checksum, dates) in cents with a 1 cent tolerance for products. `lib/einvoice/rules.ts` adds a native selection of EN 16931 and XRechnung (BR-DE) rules and code lists (`en16931-rules`, `xrechnung-rules` for the XRechnung profile only, `code-lists`; the findings start with the rule id); it is ported to `backend/src/einvoice_parse/rules.rs` and both must be changed together (regenerate the goldens with `npx vitest run golden -u`, add a case to `testdata/rules-findings.xml`). `NOT_CHECKED()` lists what is deliberately **not** checked (XSD validity, the remaining Schematron rules of EN 16931/XRechnung, unit codes beyond their format, PDF/A-3 and PDF-XML match, signatures, correctness of VAT IDs/bank data). The page never calls a file "valid" and links to the KoSIT validator and Mustang for a full check.
5. `EInvoiceView.tsx` (readable invoice, print CSS in `viewer.css`), `EInvoiceChecks.tsx` (checks), a raw XML tab.

Tests: `src/lib/einvoice/einvoice.test.ts` with fixtures in `lib/einvoice/testdata/` (CII XMLs extracted from the E01 corpus (`PDF_OUT=<dir> cargo test renders_einvoice_conformance_corpus`), hand-written UBL invoice and credit note, one real PDF). To add a case, drop the XML into `testdata/` and add it to the test lists. The static page `zugferd-xrechnung-pruefen/` (see [07](07-demo-system.md)) may only claim what the checks do.

## Vendored Typst packages

Packages are loaded from `backend/vendor/typst-packages`, so no network access is needed at runtime. Set `TYPST_PACKAGE_PATH` to use another directory; when deploying, ship the directory with the binary (the Docker image does). See `backend/vendor/typst-packages/README.md` for adding or updating packages.

The invoice template no longer uses invoice-pro/loom (they cost ~65 ms per PDF); only `sepay` (EPC QR) is imported. Old invoice-pro forks: [maltinapro/invoice-pro](https://github.com/maltinapro/invoice-pro).

## Customizing the invoice template

The invoice is a single Typst file: `frontend/src/template/invoice.typ` (the backend embeds it with `include_str!` in `backend/src/v1.rs`; there is no copy in `backend/`). It is rendered with minijinja, then compiled by Typst. Rebuild the backend after editing it.

**Data available in the template** (see `backend/src/einvoice.rs::prepare` and `v1.rs::invoice_data`):
- `settings.*` (checked settings: `accentColor`, `font`, `locale`, `footer`, `footerMode`, `intro`, `closing`, `watermark`, sender data ...) and `invoice.*` (number, recipient, items).
- Ready-made display strings from Rust: `invoice.items[*].pos/qty/price/tax/net`, `invoice.dateText`, `invoice.totals` (`net`, `gross`, `taxes[]`, `exempt`).
- `pay.*` (`sum`, `days`, `iban`, `bic`, `qr`, `amount`, `place`), `einvoice.*` (`file`, `relationship`, `description`) and the assets `assets.logo`, `assets.signature` (only set when a signature was sent; always guard with `{% if assets and assets.signature %}`) and `assets.xml`. `backend/src/signature.rs` turns a signature PDF into a cropped SVG before it becomes `assets.signature`.

**Rules**
- Interpolate user text only as Typst string literals (`#"{{ x }}"` in content mode, `"{{ x }}"` in code mode); never as markup/code. The backend escapes `\` and `"` only.
- Do the math and number formatting in Rust, not in Typst. Typst layout is what costs time; keep loops, `context`, `query`, state and heavy packages out (the old invoice-pro/loom template needed ~65 ms, this one ~8 ms).
- Keep the `#pdf.attach(...)` call: it embeds the Factur-X / XRechnung XML. The XML itself comes from `einvoice.rs`, not from the template.
- New data: compute it in `einvoice.rs` (add to `extra` or the invoice JSON) and use it here.

**Taking something from the invoice-pro fork** ([maltinapro/invoice-pro](https://github.com/maltinapro/invoice-pro), upstream [leonieziechmann/invoice-pro](https://github.com/leonieziechmann/invoice-pro), MIT; it is no longer vendored): look at the fork's `src/` for layout ideas, copy the layout code into `invoice.typ` and replace its data access (`loom` / model values) with the fields above. Keep the MIT copyright notice (© Leonie Ziechmann) if you copy substantial code, e.g. in a comment or in `README.md`. Do not re-add the package as a dependency unless you accept the performance cost.

**Checking a change**: `cd backend && cargo test --release`, start the backend (`cargo run --release`; the warm-up compiles the real template and fails loudly on errors), generate a PDF via the app or `/v1/invoices`, and for e-invoice changes run the conformance check below (or validate a single PDF with `java -jar Mustang-CLI-2.26.0.jar --action validate --source invoice.pdf`).

**E-invoice conformance check** (also runs in CI): the test `renders_einvoice_conformance_corpus` (`backend/src/v1.rs`) renders a fixed corpus: EN 16931 and XRechnung invoices with several tax rates, a 0 % item with exemption reason, an English invoice and credit notes (TypeCode 381). It always asserts that the PDF carries a complete `factur-x.xml` / `xrechnung.xml` (not `invoice-draft.xml`); with `PDF_OUT=<dir>` it writes `<dir>/einvoice-<name>.pdf`. To validate the corpus locally (Java and the Mustang CLI jar, version and SHA-256 are pinned in `.github/workflows/ci.yml`):

```bash
mkdir -p /tmp/einvoice-corpus
(cd backend && PDF_OUT=/tmp/einvoice-corpus cargo test --locked renders_einvoice_conformance_corpus)
java -jar Mustang-CLI-2.26.0.jar --action validateExpectValid --directory /tmp/einvoice-corpus --disable-file-logging
```

The exit code is non-zero if any file is invalid. Add new cases (new field, tax category, profile) to the corpus in the same PR as the change.

## Extending

- **API changes** (fields, limits, error codes of `/v1/invoices`, `/v1/documents`, their bulk variants or `GET /v1/token`): `docs/openapi.yaml` is **generated** from the Rust code (`backend/src/openapi.rs`, `utoipa` derives on the request types in `invoice.rs`/`documents.rs`/`postage.rs`/`v1.rs` and `#[utoipa::path]` on the handlers), so keep the doc comments and `#[schema(...)]` attributes of the changed fields accurate, then regenerate with `cd backend && cargo test openapi_file_is_up_to_date` and commit the file; CI fails when it is outdated. Texts, shared error responses and examples are in `backend/src/openapi_overlay.yaml`; a new error code goes into its `errorCodes` list (`openapi_lists_every_error_code` fails otherwise) and into `frontend/packages/editor/src/lib/apiErrors.ts`. Update [the API reference](09-api-reference.md) if needed. The tests `openapi_request_examples_are_accepted` and `openapi_limits_match_the_validation` (`backend/src/v1.rs`) fail when an example is no longer accepted or a limit differs from the code; run `npx @redocly/cli@2.78.0 lint docs/openapi.yaml --max-problems 0` for the lint. The frontend build (`frontend/vite.config.ts`) publishes the file as `/api/openapi.yaml` and `frontend/api/index.html` renders it with the bundled Swagger UI (`swagger-ui-dist`).
- **Postage (Internetmarke)**: backend `internetmarke.rs` (`mode_for` picks the main or the test API by token kind), UI `frontend/packages/editor/src/components/PostageSection.tsx` + `lib/postage.ts`; new `postage_*` error codes need a translation in `apiErrors.ts`, new mock behaviour goes into `backend/tools/mock_internetmarke.py` and the in-process mock of the `internetmarke.rs` tests; see [Internetmarke](14-internetmarke-integration.md).
- **Error messages**: the API keeps stable English `{error, details}` responses; `frontend/packages/editor/src/lib/apiErrors.ts` (`friendlyApiError`, used by `lib/api.ts`) turns them into plain German/English sentences. When you add a validation message or error code in the backend, add its translation and field label there.
- **Form validation UX**: inputs get a `field` key (the backend path without `invoice.`/`document.`, e.g. `recipient.name`, `items[0].price`, `settings.bank.iban`). `lib/validate.ts` produces `Issue`s (`requiredIssues` = blocking rules mirrored from the backend, `validateInvoice` = non-blocking e-invoice hints); backend `validation_error` responses arrive as a `ValidationError` with the same field keys (`lib/api.ts`). `PaperEditor` merges them (client findings win), shows one clickable summary that selects the field's zone, exposes the appropriate compact view and focuses the input, marks inputs with a red border and an inline message only once they were touched, after a backend rejection or after a download attempt, and pauses the preview while required fields are missing. New inputs need a `field` prop and a label entry in `apiErrors.ts`; keep `requiredIssues` in line with `backend/src/invoice.rs` / `documents.rs`.
- **DIN 5008 layout**: all templates (the shared `layout.typ` that every document type includes) follow DIN 5008 Form B: margins left 25 mm / right 20 mm / bottom 20 mm, address field from 45 mm (7 pt return line, no blank line between street and city), reference line at about 98.5 mm, fold marks at 105 and 210 mm and punch mark at 148.5 mm (drawn in the page `background`, together with the watermark). The positions exist once in `layout.typ`; the amounts show a non-breaking space before `%` (`einvoice.rs`). Only the layout is checked by hand, not certified.
- **New document type**: add an entry to `DOC_SPECS` in `frontend/packages/editor/src/lib/documents.ts` (dashboard tile and form fields), a template `frontend/src/template/<type>.typ` that builds on `layout.typ` (`letterhead`, `doc-heading`, `items-table`, `totals-block`, …), and the type in `Kind` in `backend/src/documents.rs` (slug, template, validation). Add an icon in `components/icons.tsx`. Drafts of all types except invoices live in `localStorage` key `pdfcraft.documents`. A type that is available through the API only (the `dunning` type has no editor form and no dashboard tile on purpose: dunning belongs to the calling accounting system, e.g. FediFinance) needs just the backend part. Besides `Kind`, add the type to the request examples of `backend/src/openapi_overlay.yaml` (`createDocument` and the `getVersion` template hashes), the `Kind::ALL` render tests in `backend/src/v1/tests.rs` (their raw documents need the new fields), the API reference and regenerate `docs/openapi.yaml`.

- **New setting / field**: add it to `frontend/packages/editor/src/lib/types.ts`, validate it in `backend/src/invoice.rs`, add an input in the matching form, and handle it in `backend/src/einvoice.rs` (totals, XML) if it affects amounts or the e-invoice, and use it in `frontend/src/template/invoice.typ`.
- **Document design**: `settings.design` is an allow-listed `classic` / `modern-minimal` / `contrast` value (`DESIGNS` in `backend/src/invoice.rs` and `frontend/packages/editor/src/lib/types.ts`). A design is an entry in the `designs` token dictionary in `layout.typ` (header, meta block, title, table, totals, payment block, footer variants); add the value, a thumbnail (page 1 of a real render, `frontend/public/design-previews/`) and a picker description, then regenerate `docs/openapi.yaml`. Do not move the DIN 5008 address field, reference line or page marks. Existing config files default to Classic; archive snapshots retain their issue-time design. `renders_every_document_type` and the e-invoice corpus cover all designs, and the ignored release benchmark reports their render times separately.
- **New unit or tax rate**: extend `UNITS` / `TAX_RATES` in `types.ts` (also add the unit label/UN code in `einvoice.rs` and the template).
- **Master data** (saved recipients and articles): `frontend/src/lib/masterData.ts` keeps them in `localStorage` key `pdfcraft.masterData` (`masterDataVersion` 1) and as a small external store (`useMasterData()`), so the page `#/contacts` / `#/articles` (`MasterDataPage`) and the pickers in the forms (`RecipientPicker` in `InvoiceForm`/`DocumentForm`, `ArticlePicker` and "Save as article" in `ItemsEditor`) share one state. A recipient is identified by name + address + city, an article by description + unit + VAT rate (saving again updates the rest); picking a recipient fills the recipient fields, picking an article only appends a new line, so edited lines are never overwritten. The parser is strict (units must be in `UNITS`, VAT rates in `TAX_RATES`, same length/number limits as the backend; one invalid entry rejects the whole file) and is used for both the stored value and the backup. The backup (`backup.ts`, `BACKUP_VERSION` 2) contains it as `masterData`; a restore merges it (existing entries win), `Reset` removes it, "Import from issued documents" derives recipients and articles from the archive (priced documents only) and adds only what is new. The first save of real data asks the browser for persistent storage (`navigator.storage.persist()`). Add a new field to the stored entries in `masterData.ts` (parser, `Contact`/`Article`) and bump `MASTER_DATA_VERSION` with a migration in `parseMasterData`. Nothing is sent to the server except as part of a document request.
- **Frontend tests**: `cd frontend && npm test` (Vitest, no DOM; `localStorage` is faked in the test) runs the unit tests next to the code (`src/lib/*.test.ts`); CI runs them before the build.
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

### Dependency rationale

Every direct dependency and why it is there (`backend/Cargo.toml`). `cargo deny check` (in `backend/`) audits licenses and advisories; ignored advisories in `deny.toml` carry a reason.

| Crate | Why |
| --- | --- |
| `axum`, `tokio`, `tower-http` | HTTP server, async runtime (only the needed features), CORS |
| `serde`, `serde_json`, `serde_norway` | Request/response types; YAML for the OpenAPI overlay (`serde_yaml` stays only as a transitive Typst dependency) |
| `minijinja` | Fills the Typst templates |
| `typst`, `typst-layout`, `typst-pdf`, `typst-as-lib`, `typst-kit` | Typst compile, layout, PDF/A export, in-memory fonts; bumped together |
| `lopdf` | Factur-X XMP post-processing (`facturx.rs`) |
| `hayro-svg`, `usvg`, `resvg`, `tiny-skia` | Convert a signature PDF to SVG and crop it to the visible content (`signature.rs`) |
| `zip` | Bulk ZIP responses |
| `redis` | Valkey: tokens, rate limit, one-time markers |
| `sha2`, `rand`, `ed25519-dalek` | Token hashing and generation, Anubis pass verification |
| `base64` | Logo, signature and stamp payloads |
| `reqwest` | Outgoing calls to Mollie and Deutsche Post (timeouts, no redirects) |
| `tracing`, `tracing-subscriber`, `prometheus-client` | JSON logs and metrics |
| `utoipa` | Generates `docs/openapi.yaml` from the code |

Frontend: `react`/`vite` (app), `pdfjs-dist` (legacy build; preview and viewer), `@fontsource-variable/inter` (self-hosted font), `swagger-ui-dist` (lazy API reference), `vitest` (tests), `oxlint` (lint; typescript-eslint cannot be used with TypeScript 7), `playwright` (screenshots).

## CI and dependency updates

- `.github/workflows/ci.yml` runs on every PR and on `main`: frontend `npm ci`, `npm run lint` (oxlint), `npm audit`, `npm test`, `npm run build` and `npm run budget` (bundle limits); backend `cargo fmt --check`, `cargo check --locked --all-targets`, `cargo clippy --locked --all-targets -- -D warnings` and `cargo test --locked` (with a Valkey service so the `store.rs` tests run); job `deny` runs `cargo deny check` (with dependency caching). `helm-lint.yml` lints the chart when `deploy/` changes. The job `einvoice` renders the e-invoice corpus (see "E-invoice conformance check" above), downloads the pinned Mustang CLI (checksum verified, cached) and fails if Mustang reports any file as invalid. The backend tests also fail when the generated `docs/openapi.yaml` is outdated; the job `openapi` lints it with the pinned Redocly CLI (warnings fail the job). Make the `CI` jobs (`frontend`, `backend`, `einvoice`, `openapi`) required checks in the branch protection of `main`.
- `renovate.json` configures Renovate (npm, cargo, GitHub Actions, Dockerfiles, Helm values). Updates run weekly (Monday before 06:00), minor/patch updates are grouped per ecosystem, Typst crates are bumped together. The issue "Dependency Dashboard" gives the overview. Requires the Renovate GitHub App to be installed for the repository (https://github.com/apps/renovate).
