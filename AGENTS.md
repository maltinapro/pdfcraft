# AGENTS.md

## Project
PDFCraft is a full-stack PDF template builder:
- Frontend: React + Vite (form-based invoice configurator)
- Backend: Rust + Axum
- Templating: minijinja
- PDF generation path (current backend): Typst via `typst-as-lib`

## Language Conventions
- Write pull request titles/descriptions and commit messages in English.
- Keep `README.md` up to date: whenever a change affects setup, architecture, project structure, features, API or the tech stack, update the README in the same PR.
- Work in one PR per roadmap step, branched from the latest `main`, so each step can be tested locally.
- PR titles must follow Conventional Commits (e.g. `feat: ...`), because PRs are squash-merged and the title becomes the commit message.

## Repository Structure
- `frontend/` — configurator UI, request building, static template `src/template/invoice.typ`
- `backend/` — API server (`/generate-pdf`, `/health`)
- `README.md` — product overview and setup

## Local Development
### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Backend
```bash
cd backend
cargo run
```

## Validation Commands
Backend checks used in this project:
```bash
cd backend
cargo check
```

Frontend checks used in this project:
```bash
cd frontend
npm run build
```

## Backend PDF Pipeline (Current)
1. Receive `{ template, data }` in `POST /generate-pdf`
2. Render template with minijinja (`template` + `data`)
3. Compile rendered Typst content to document using `typst-as-lib` + Typst
4. Convert document to PDF bytes with `typst-pdf`
5. Return PDF with content headers

## Recent Changes Applied
- Replaced old Tectonic/LaTeX compilation path in backend handler with Typst-based flow.
- Updated backend dependencies to Typst ecosystem:
  - `typst = "0.15.1"`
  - `typst-pdf = "0.15.1"`
  - `typst-as-lib = "0.17.0"`
- Confirmed build health with `cargo check`.
- Migrated frontend template serializer from LaTeX output to Typst output.
  - Renamed serializer file from `frontend/src/lib/tiptapToLatex.ts` to `frontend/src/lib/tiptapToTypst.ts`
  - Renamed exported function to `tiptapToTypst`
  - Updated `frontend/src/App.tsx` imports and calls to use the Typst serializer
  - Updated UI labels from LaTeX preview/builder wording to Typst wording
- Confirmed frontend build health with `npm run build`.
- Refreshed `README.md` to consistently document the Typst-based pipeline.
  - Replaced remaining LaTeX/Tectonic references in flow descriptions and API docs
  - Updated serializer and extension guidance to `tiptapToTypst`
  - Updated examples and tech stack wording to match current implementation
- Performed a migration audit for Typst alignment across backend and frontend.
  - Verified backend compile path uses `typst-as-lib` + `typst-pdf` and no active LaTeX/Tectonic pipeline
  - Verified frontend uses `tiptapToTypst` serializer and Typst preview/generation flow
  - Confirmed project health with `cd backend && cargo check` and `cd frontend && npm run build`
  - Collected version update signals (`npm outdated`, `cargo search`) for future dependency planning
- Hardened backend request handling and error responses.
  - Added request body limit via `DefaultBodyLimit::max(512 * 1024)`
  - Added structured JSON error responses with explicit error codes/details
  - Mapped invalid payload/template/render errors to client-oriented status codes
- Improved frontend runtime configuration and naming consistency.
  - Kept PDF API base URL configurable via `VITE_API_BASE_URL` with localhost fallback
  - Added `frontend/src/vite-env.d.ts` for `import.meta.env` typing
  - Renamed remaining preview classes from `latex-*` to `typst-*` in `App.tsx` and `App.css`
- Re-validated project health after the above updates.
  - Confirmed backend with `cd backend && cargo check`
  - Confirmed frontend with `cd frontend && npm run build`
- Added a dedicated Invoice-Pro Typst example flow in the frontend.
  - Added `INVOICE_PRO_TEMPLATE` based on `@preview/invoice-pro:0.3.2` with minijinja placeholders
  - Added `INVOICE_PRO_SAMPLE_DATA` to demonstrate the expected invoice data structure
  - Added a separate header action to generate and download `invoice-pro-example.pdf`
  - Refactored frontend PDF request logic into a shared helper used by both editor and invoice example flows
- Re-validated project health after adding the Invoice-Pro example flow.
  - Confirmed frontend with `cd frontend && npm run build`
  - Confirmed backend with `cd backend && cargo check`
- Expanded the Invoice-Pro example integration to better support troubleshooting empty PDF exports.
  - Added a richer `INVOICE_PRO_TEMPLATE` in `frontend/src/App.tsx` using `@preview/invoice-pro:0.3.2`
  - Added `INVOICE_PRO_SAMPLE_DATA` with sender/recipient, invoice meta, line items, payment goal, and bank details
  - Unified PDF request handling via a shared `requestPdf(...)` helper for both editor export and Invoice-Pro export
  - Added a dedicated Invoice-Pro header action and sample-data panel in the sidebar for clearer structure visibility
- Re-validated project health after the expanded Invoice-Pro integration.
  - Confirmed frontend with `cd frontend && npm run build`
  - Confirmed backend with `cd backend && cargo check`
- Fixed Typst package resolution for Invoice-Pro imports in backend PDF generation.
  - Enabled `typst-as-lib` features `packages` and `ureq` in `backend/Cargo.toml`
  - Added `.with_package_file_resolver()` to backend Typst engine construction in `backend/src/main.rs`
  - Resolved `@preview/invoice-pro` compile failures like `file not found (searched at typst.toml)`
- Re-validated project health after package resolver integration.
  - Confirmed backend with `cd backend && cargo check`
  - Confirmed frontend with `cd frontend && npm run build`
- Improved Invoice-Pro template resilience for minimal mapping deltas.
  - Added fallback for sender tax number in `frontend/src/App.tsx`: `sender.taxNr or sender.tax_nr`
  - Added fallback for line item title in `frontend/src/App.tsx`: `item.label or item.name`
- Verified Todo 5 (sample-data mapping delta) in `frontend/src/App.tsx`.
  - Confirmed `INVOICE_PRO_SAMPLE_DATA.sender.tax_nr` is present.
  - Confirmed `INVOICE_PRO_SAMPLE_DATA.lineItems[*].name` is present.
  - No further sample-data changes required for the identified delta.
- Executed Todo 6 with an end-to-end backend export check for Invoice-Pro.
  - Sent `POST /generate-pdf` using data with fallback-only fields (`sender.tax_nr` and `lineItems[*].name`).
  - Confirmed response status `200`, `Content-Type: application/pdf`, and non-empty payload (`19002` bytes).
  - Extracted PDF strings confirmed rendered invoice identifier `Invoice 2026-01` in output metadata.
- Unified frontend UI flow to Invoice-Pro-only and removed stale mapping helper state.
  - Removed unused `INVOICE_PRO_MAPPING_DELTA` constant from `frontend/src/App.tsx`.
  - Aligned default subreport row placeholder with fallback mapping: `{{item.label or item.name}}`.
  - Restored `escapeForTypstStrings(...)` helper in `frontend/src/App.tsx` to keep PDF request data escaping intact.
- Re-validated frontend health after Todo 7 updates.
  - Confirmed frontend with `cd frontend && npm run build`.
- Optimized backend PDF generation performance (Invoice-Pro: ~2 s → ~50–100 ms depending on CPU clock).
  - `backend/src/main.rs` uses one shared `TypstEngine` (`OnceLock`) with fonts and package resolver; each request's rendered template is registered as a unique virtual file (`/req-N.typ`) via a custom `FileResolver` and removed afterwards.
  - comemo eviction max age is `Some(10)`; a warm-up compile runs at startup.
  - Per-request timing logs: `typst layout`, `pdf export`, `typst compile+pdf`.
  - `backend/Cargo.toml` dev profile is optimized (`opt-level = 1`, dependencies `opt-level = 3`, no debug assertions/overflow checks/debug info for dependencies).
  - Measured: remaining time is Typst layout of Invoice-Pro (single-threaded, CPU-clock bound); PDF export is ~2 ms.
  - Deliberately NO PDF/result cache: customer data must not be retained between requests. comemo may still hold intermediates for up to 10 compilations; use `comemo_evict_max_age(Some(0))` if that is not acceptable.

## Notes for Next Work
- Do not add caches of rendered templates or generated PDFs (customer data).
- Frontend serializer and backend template language should stay aligned.
- Add new form fields in `types.ts` + `buildRequest.ts` (escape/validate) + the form + `invoice.typ`. User data goes only into Typst string literals (escape `\` and `"`).
- Keep `cargo check` green after any backend change.
- Keep `npm run build` green after any frontend change.

## Roadmap / TODOs (resume here)
Vision: simple form-based invoice configurator (logo, company address, minimal customizing, ZUGFeRD) on a fixed Typst template (invoice-pro); config saved as versioned JSON in browser storage, downloadable/importable.

- [x] 1. Vendor Typst packages (no runtime network)
  - `backend/vendor/typst-packages/preview/{invoice-pro/0.5.0,ibanator,letter-pro,loom,sepay,rustycure}` (see its README.md)
  - `backend/src/main.rs`: `FileSystemResolver::local_package_root` (cached); path from env `TYPST_PACKAGE_PATH`, default `<manifest>/vendor/typst-packages`
  - Removed `packages`/`ureq` features from `typst-as-lib`
  - Verified: `cargo check` green; `POST /generate-pdf` with invoice-pro template returned 200 PDF (~97 ms)
  - invoice-pro upgraded 0.3.2 → 0.5.0 (has built-in ZUGFeRD/Factur-X via `zugferd: "en16931"`); frontend preamble + warm-up updated to 0.5.0 and verified (200 PDF)
  - Backend now exports PDF/A-3b (`pdf_options()` in `main.rs`), required to embed the XML. Verified: 0.5.0 template → 200, `factur-x.xml` embedded, `pdfaid:part=3`, conformance B
  - Note: Docker/deploy must copy `vendor/typst-packages` or set `TYPST_PACKAGE_PATH`
- [x] 2. Form-based configurator replaces Tiptap (PR `feat/invoice-configurator`)
  - Static template `frontend/src/template/invoice.typ`; `lib/buildRequest.ts` validates/escapes; debounced (600 ms) iframe preview; PDF download
  - Backend `assets` field (base64, e.g. logo): per-request virtual files, exposed as `{{ assets.<key> }}`; body limit 2 MB
  - Tiptap/katex and `tiptapToTypst` removed; ZUGFeRD enabled via `zugferd: "en16931"`
- [x] 3. Persistence (PR `feat/config-persistence`)
  - `frontend/src/lib/storage.ts`: versioned (`schemaVersion` = 1) config `{settings, invoice}` in localStorage key `pdfcraft.config` (logo stays base64 inside, ≤ 300 KB), auto-save (400 ms debounce)
  - JSON export/import/reset in the header; `parseConfig` validates/merges with defaults and rejects newer versions; add migrations there when bumping `SCHEMA_VERSION`
- [x] 4. ZUGFeRD/Factur-X (PR `feat/zugferd-mapping`): invoice-pro 0.5.0 creates/embeds the XML (EN16931); no own XML generation
  - Form data is mapped (sender tax-nr/vat-id/email, recipient vat-id/email/buyer-reference, unit codes, IBAN/BIC, `#payment-goal`); `frontend/src/lib/validate.ts` shows e-invoice issues (errors/warnings, IBAN checksum) in the sidebar; invoice-pro's own `zugferd-errors: "report"` prints remaining problems into the PDF (then only `invoice-draft.xml` is attached)
  - 0% items must use an explicit category: template emits `tax.exempt(grounds: ...)` from `settings.exemptionReason` (raw `0%` makes Typst panic)
  - Validated with Mustang 2.26.0: embedded XML valid (EN16931), PDF/A-3b compliant. Remaining known limitation: missing Factur-X XMP metadata (PDF-level ZUGFeRD validators report it); XRechnung-only rules (BR-DE-5/6/21/27, seller contact) are notices, not errors. Optional future: Mustang post-processing for XMP
- [ ] 5. Optional: fork invoice-pro into own template to be independent of upstream
