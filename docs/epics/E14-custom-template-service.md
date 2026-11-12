# E14 – Custom template service

**Phase:** 4 · **Depends on:** E11 (design refactor) · **Business plan:** section 6.3 · **Status:** open

## Goal
Sell "Custom Typst Template Setup" (plan: 750 € once) to businesses that want their exact letterhead and layout via API or self-hosted. For that the product must load customer templates safely and repeatably; today the templates are compiled into the backend (`include_str!`).

## Context / links
- `backend/src/documents.rs`, `backend/src/v1.rs`, `backend/src/main.rs` (shared `TypstEngine`, virtual files per request, `VirtualFiles` guard), `frontend/src/template/`, vendored packages (`TYPST_PACKAGE_PATH`).
- Many requests are only a letterhead (background plus fixed margins); a configurable letterhead may cover most of them without custom Typst code.

## Definition of done
- A template pack can be added to a deployment without rebuilding the backend and selected by id; a checker confirms it renders every document type with valid e-invoice output; the service has a defined scope and process.

## Issues
- [ ] **E14-01 Productize the service** – Scope, deliverables, number of revisions, acceptance, what needs customer material (letterhead, fonts, brand colors), price 750 €, change requests. AC: one-pager and checklist in the repo; linked from the enterprise and pricing pages (E03-06).
- [ ] **E14-02 Letterhead feature** – Optional letterhead background (PDF/SVG/PNG asset, like logo and signature) with configurable first-page and following-page behavior and safe zones; reuses the PDF-to-SVG conversion in `signature.rs`. AC: works for every document type, keeps the DIN 5008 address window usable; covers the common "just my letterhead" case.
- [ ] **E14-03 External template packs** – Backend loads additional templates from a configured directory (`TEMPLATE_DIR`) next to the built-in ones; selection by `settings.template`/`design` id. AC: built-in templates unchanged and the default; no restart-free hot reload required; startup validates every pack.
- [ ] **E14-04 Template pack format** – Manifest (id, name, version, supported document types, required data fields, assets), compatibility version against the data model, documented upgrade path when fields change. AC: spec in `docs/17-custom-templates.md`; example pack in the repo.
- [ ] **E14-05 Sandbox and safety** – Packs may only read their own files and vendored packages (no arbitrary file or network access); user data goes only into Typst string literals as today; limits on compile time and memory per request. AC: tests for path traversal and a hostile template; failure returns a stable error code.
- [ ] **E14-06 Pack checker CLI** – `pdfcraft-backend templates check <dir>`: renders all supported document types (with/without watermark, long tables, special characters), validates the e-invoice output and reports issues. AC: used in CI for the example pack; exit code reflects failures.
- [ ] **E14-07 Per-customer assignment** – For hosted use, bind a template id to a token/plan (stored with the token metadata); for self-hosted, a default id via env. AC: unknown or unavailable ids fall back with a clear error, not silently to the default.
- [ ] **E14-08 Deployment of packs** – Helm values to mount packs (ConfigMap, volume or init container) and Compose example. AC: documented procedure to add and update a pack without rebuilding images.
- [ ] **E14-09 Customer preview and acceptance** – A way to preview the customer's template with sample data and export a review PDF set. AC: documented; no real customer data needed.
- [ ] **E14-10 Docs and news** – Authoring guide, README, landing page mention. AC: guide verified by building the example pack from scratch.

## Open questions
- Are custom templates available on the hosted API (shared infrastructure) or only self-hosted/dedicated?
