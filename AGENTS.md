# AGENTS.md

## Project
PDFCraft is a full-stack PDF template builder:
- Frontend: React + Vite (form-based invoice configurator)
- Backend: Rust + Axum
- Templating: minijinja
- PDF generation path (current backend): Typst via `typst-as-lib`

## Language Conventions
- Write pull request titles/descriptions and commit messages in English.
- Keep `README.md` (short overview) and `docs/` (details) up to date: whenever a change affects setup, architecture, project structure, features, API, configuration or the tech stack, update the affected file in the same PR. Keep the README short; put details in `docs/`.
- Work in one PR per roadmap step, branched from the latest `main`, so each step can be tested locally.
- PR titles must follow Conventional Commits (e.g. `feat: ...`), because PRs are squash-merged and the title becomes the commit message.

## Repository Structure
- `frontend/` — configurator UI, free-token handling (`lib/api.ts`), static template `src/template/invoice.typ`
- `backend/` — API server (`/v1/invoices`, `/v1/invoices/bulk`, `/v1/free-token`, `/health`; metrics on a separate listener)
- `deploy/helm/pdfcraft/` — Helm chart (optional PodMonitor/PrometheusRule, Grafana dashboards in `dashboards/`)
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

## Factur-X XMP post-processing
Typst/krilla writes its own XMP and cannot be extended (XMP cannot be extended from Typst). `backend/src/facturx.rs` (lopdf) adds the `fx:` extension schema + `DocumentFileName/DocumentType/Version/ConformanceLevel` to the PDF's XMP when `factur-x.xml`/`xrechnung.xml` is attached (not for `invoice-draft.xml`); on any failure the unmodified PDF is returned. Verified with Mustang 2.26.0: `Parsed PDF:valid XML:valid`.

## Notes for Next Work
- Visual verification is mandatory: after every PDF or frontend change, look at the result yourself before reporting it done. Frontend: run `npm run dev` in `frontend/`, open the page with Playwright (also check DE and EN, light/dark and a narrow width where relevant) and take a screenshot; mock API responses by overriding `window.fetch` if the backend is not running. PDF: render with `PDF_OUT=<dir> cargo test v1::tests` (with and without watermark), rasterize (e.g. PyMuPDF) and view the pages. Do not rely on build/test output alone.
- Everything must be startable locally with `docker compose` (`docker-compose.yml`, `deploy/compose/`): every feature and every external dependency (e.g. Valkey, Anubis, Mollie, Internetmarke) needs a Compose service or a mock (profile `mock`) plus a documented command, so it can be tried end to end without real accounts. Update Compose and the docs in the same PR when adding such a feature.
- Do not add caches of rendered templates or generated PDFs (customer data).
- Frontend serializer and backend template language should stay aligned.
- Add new form fields in `types.ts` + `backend/src/invoice.rs` (validate/escape; the frontend sends raw form values) + `backend/src/einvoice.rs` (totals/XML) + the form + `invoice.typ`. User data goes only into Typst string literals (escape `\` and `"`).
- Observability: logs are JSON on stdout (`backend/src/telemetry.rs`); metrics in `backend/src/metrics.rs` (OpenMetrics on `METRICS_ADDR`, never via Ingress/Service; `token_id` label only for paid tokens). New metrics must be added to the dashboards in `deploy/helm/pdfcraft/dashboards/` and `docs/13-observability.md`.
- User-visible changes: add a short entry to the "Neuigkeiten" section of `frontend/index.html` (static, no runtime fetch from GitHub; full notes live in the GitHub releases).
- Keep `cargo check` green after any backend change.
- Keep `npm run build` green after any frontend change.

## Roadmap / TODOs (resume here)
Vision: simple form-based invoice configurator (logo, company address, minimal customizing, ZUGFeRD) on a fixed Typst template (invoice-pro); config saved as versioned JSON in browser storage, downloadable/importable.

- [x] 1. (SUPERSEDED by step 30: invoice-pro/loom no longer used or vendored) Vendor Typst packages (no runtime network)
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
  - Validated with Mustang 2.26.0: embedded XML valid (EN16931), PDF/A-3b compliant. Remaining known limitation: missing Factur-X XMP metadata (PDF-level ZUGFeRD validators report it); XRechnung-only rules (BR-DE-5/6/21/27, seller contact) are notices, not errors. XMP gap is now fixed in the backend (see below)
- [x] 5. (SUPERSEDED by step 30: invoice-pro/loom no longer used or vendored) invoice-pro fork (PR `feat/invoice-pro-fork`): https://github.com/maltinapro/invoice-pro (fork of leonieziechmann/invoice-pro, MIT). Branch `pdfcraft` based on upstream tag `v0.5.0` (NOT upstream `main`, which has unreleased API changes), tag `v0.5.0-pdfcraft.1`; `FORK.md` documents source/changes, upstream `LICENSE` stays unchanged. Vendored copy in `backend/vendor/typst-packages/preview/invoice-pro/0.5.0` (+ `FORK.md`). Workflow for template changes: commit in fork, tag `v0.5.0-pdfcraft.<n>`, re-copy into vendor, list the change in `FORK.md`. Fork must be created manually (session token cannot fork/create repos)
- [x] 6. (SUPERSEDED by step 30: invoice-pro/loom no longer used or vendored) XRechnung profile + fork on upstream `main` (PR `feat/xrechnung-profile`): fork branch `pdfcraft` = upstream `main` @ 794f21d + `FORK.md`, tag `v0.5.0-pdfcraft.2` (still vendored as `invoice-pro/0.5.0`; API differs from released 0.5.0: `theme.classic.with(theme.custom.brand(..))`, `payment-terms`). Form: `settings.einvoiceProfile` (`en16931`/`xrechnung`) and `sender.contactName`; template emits `sender.contact`; XRechnung attaches `xrechnung.xml`. Mustang: both profiles valid, BR-DE-5/6/15/21/27 satisfied with the XRechnung profile + contact + phone + buyer reference
- [x] 8. Layout parity (PR `feat/layout-parity`): template on `theme.classic` now restores the old look: zebra rows via `theme.custom.items-table(zebra: (none, accent.lighten(85%)))`, custom `settings.footer` replaces the footer area (`theme.custom.area("footer", ...)`, every page), removed bogus `register:` sender key. Logo is `brand(logo:)`. Verified: 200 PDF, visual check, Mustang valid
- [x] 7. Docker (PR `feat/docker`): `backend/Dockerfile` (release build, bundles `vendor/typst-packages`, `TYPST_PACKAGE_PATH`), `frontend/Dockerfile` (nginx, build arg `VITE_API_BASE_URL`), `docker-compose.yml` (frontend :8080, backend :3000). Verified: both images build, container returns a 200 PDF; `docker compose` itself not run (plugin missing in the dev env)
- [x] 9. Backend usage docs (PR `docs/backend-usage`): README section "Using the backend directly (REST)"; header button "API-Request" exports the exact `{template, data, assets}` body (`pdfcraft-request.json`). The config export (`pdfcraft-config.json`) is NOT an API payload. Idea, not done: `/v1/invoices` endpoint, API key, rate limit, ZIP bulk
- [x] 10. Production API (PR `feat/v1-api`): `POST /v1/invoices` (PDF) and `/v1/invoices/bulk` (ZIP) with server-side template (`include_str!` of `frontend/src/template/invoice.typ`), input = config-export JSON validated/escaped in `backend/src/invoice.rs` (must mirror `buildRequest.ts`), API keys (`API_KEYS`, Bearer or X-API-Key), per-key token-bucket rate limit, global compile semaphore, `CORS_ALLOWED_ORIGINS`, `ENABLE_GENERATE_PDF`. Env table in README "Configuration". Backend Docker build context is now the repo root. Verified: auth/401/503, validation 400, bulk ZIP, 429 + Retry-After, CORS list, Mustang valid, container smoke test. Not done: persistent/shared rate limit across instances, key rotation, request logging
- [x] 11. Shared API keys + rate limit (PR `feat/db-keys-redis`, stacked on `feat/v1-api`): `backend/src/store.rs`; keys in Postgres (`DATABASE_URL`, table `api_keys`, SHA-256 hashes, per-key limit, 30 s lookup cache), CLI `pdfcraft-backend keys create|list|revoke|activate`; Redis token bucket via Lua (`REDIS_URL`), falls back to in-memory on outage; `API_KEYS` env still works. Verified with 2 instances: shared limit, 401 after revoke, fallback with Redis down. Not done: Admin API/UI, key expiry, usage stats, TLS options for Postgres beyond sqlx defaults, `docker compose` itself
- [x] 12. Docs (PR `docs/deployment-guides`): `docs/` folder with index + 8 guides (overview/modes, local dev, Docker, configuration, API keys/rate limit, production, demo, Helm outlook, not implemented); README links to it. Keep docs in sync with config changes
- [x] 13. Slim README (PR `docs/slim-readme`): README shortened to overview/quick start/links; API reference and architecture moved to `docs/09-api-reference.md` and `docs/10-architecture-and-extending.md`
- [x] 14. Landing page (PR `feat/landing-page`): German static landing page `frontend/index.html` (`/`), app moved to `frontend/app/index.html` (`/app/`), legal pages in `impressum.html`/`datenschutz.html` (updated before deployment; see step 21); Vite multi-page build in `vite.config.ts`
- [x] 15. Helm demo chart (PR `feat/helm-demo`): `.github/workflows/release-images.yml` (manual "Run workflow" button with a tag input) builds/pushes `ghcr.io/maltinapro/pdfcraft-{backend,frontend}` (frontend with empty `VITE_API_BASE_URL`, same origin); `helm-lint.yml` lints the chart on PRs; `deploy/helm/pdfcraft` (backend, frontend, Traefik ingress + cert-manager) for `pdfcraft.vorneweg.org` on k3s. No Postgres/Redis yet (operators planned), no per-IP rate limit. GHCR packages must be set to public manually once
- [x] 16. Sortable items + flicker-free preview (PR `feat/sortable-items-preview`): native drag & drop plus up/down buttons for invoice items; preview double-buffers two iframes (new PDF loads hidden, swaps on `load`, 2.5 s fallback) and skips identical requests
- [x] 17. Chart in GHCR (PR `ci/helm-oci-chart`): `release-images.yml` also packages/pushes `oci://ghcr.io/maltinapro/charts/pdfcraft` (inputs `tag` = appVersion, `chart_version`); `image.tag` empty = appVersion; package must be set to public once
- [x] 18. Multi-arch images (PR `ci/arm64-images`): backend built natively per arch (amd64 + `ubuntu-24.04-arm` runner), pushed by digest and merged into one manifest; frontend Dockerfile build stage uses `--platform=$BUILDPLATFORM`, built for amd64+arm64 in one job
- [x] 19. Release trigger (PR `ci/release-trigger`): publishing a GitHub release `vX.Y.Z` runs `release-images.yml` (images tagged `X.Y.Z`, `X.Y`, sha, `latest` unless pre-release; chart version = appVersion = `X.Y.Z`); manual run kept for tests
- [x] 20. Responsive layout (PR `feat/responsive-layout`): below 800 px the app shows a Formular/Vorschau switch (`mobileView` in `App.tsx`); the hidden pane stays laid out off-screen so the preview iframe keeps loading; header buttons wrap. Also: frontend Dockerfile builds in `/build` (build root `/app` made Vite drop `dist/index.html`)
- [x] 21. Privacy policy (PR `docs/datenschutz-hetzner`): merged; controller details taken from the Impressum, hosting documented as Hetzner VMs in Germany. Operator must ensure the stated data-processing agreement and log-retention policy match actual operations.
- [x] 22. Live demo: operator confirmed deployment on 2026-10-31 at https://digitalrechnung.jetzt (configurator: https://digitalrechnung.jetzt/app/), including the merged privacy policy and responsive layout changes. README links to the demo. Mobile PDF rendering across browsers has not been fully verified.
- [x] 23. Valkey tokens (PR `feat/valkey-tokens`): Postgres, `API_KEYS` and the in-memory limiter are gone; `backend/src/store.rs` keeps hashed tokens (`pf_<id>_<secret>` free, `pk_<id>_<secret>` paid) and token-bucket rate limits only in Valkey (`VALKEY_URL`, persistent via append-only file; Compose service + Helm StatefulSet). Free limit is static config (`FREE_RATE_LIMIT_PER_MINUTE`), paid limit comes from the plan (`PAID_PLANS`); paid tokens are behind `PAID_TOKENS_ENABLED` (default false). CLI: `pdfcraft-backend tokens create|create-free|list|extend|revoke`. Stacked follow-ups: free token + Anubis + watermark, frontend switch to `/v1`, Stripe, landing/privacy texts
- [x] 24. Free token + Anubis + watermark (PR `feat/free-token-anubis`, stacked on `feat/valkey-tokens`): `backend/src/free.rs` issues `POST /v1/free-token` only for browsers with a valid Anubis cookie (EdDSA JWT verified with `ANUBIS_PUBLIC_KEY_HEX`, one token per pass via Valkey `SET NX`); `anubis-keygen` CLI; free-token PDFs get `settings.watermark = "Entwurf"` (template area in `invoice.typ`). Compose: `edge` nginx + `anubis` + frontend; Helm: `templates/anubis.yaml`, ingress `/v1` -> backend, `/` -> Anubis. Anubis must never front `/v1`. Verified with a real Anubis v1.28.2 container and a browser
- [x] 25. Frontend on `/v1` (PR `feat/frontend-free-token`, stacked on `feat/free-token-anubis`): `/generate-pdf`, `ENABLE_GENERATE_PDF`, `buildRequest.ts` and the "API-Request" button are removed; `frontend/src/lib/api.ts` fetches a free token from `/v1/free-token` (token in localStorage `pdfcraft.freeToken`, re-fetched on 401/expiry; `VITE_API_TOKEN` overrides it for development) and calls `POST /v1/invoices` with `{settings, invoice}`. Landing page explains free vs. purchased tokens
- [x] 26. (SUPERSEDED by step 41: Stripe replaced by Mollie) Purchased tokens via Stripe (PR `feat/paid-token-stripe`, stacked on `feat/frontend-free-token`): `backend/src/stripe.rs`: `POST /v1/stripe/webhook` (HMAC signature, `checkout.session.completed` creates or extends by `metadata.token_id`, `invoice.paid` subscription renewal to period end + `PAID_GRACE_DAYS`), one-time `GET /v1/tokens/claim?session_id=`; everything `404` unless `PAID_TOKENS_ENABLED=true`, needs `STRIPE_WEBHOOK_SECRET`. Only the token hash/plan/end date is stored. Tested with signed fake events, NOT against live Stripe. Guide: `docs/12-paid-tokens-stripe.md`
- [x] 27. Texts (PR `docs/maltina-vorneweg-privacy`): landing page section "Wer steckt dahinter?" (maltina.pro UG in formation develops; Vorneweg provides infrastructure, operation, resources), contact https://maltina.pro/ + hello@maltina.pro on landing page, imprint and privacy policy; privacy policy covers Anubis cookie, free token (localStorage + Valkey hashes, no customer data) and announces Stripe for purchased tokens. Operator must verify legal wording (controller changed to maltina.pro UG i. G. in step 43) before go-live. vorneweg.org could not be read in the dev environment: the landing text is generic about Vorneweg's principles
- [x] 28. Observability (PRs #40-#43): JSON logging for Loki, Prometheus metrics (technical + token-based business metrics, `METRICS_ADDR`, default `:9090`), chart options `metrics.podMonitor`/`metrics.prometheusRule`/`grafana.dashboards` (all optional, Prometheus/Grafana operators), 3 dashboards (business, technical, logs) as JSON in the chart. Dashboards deploy as `GrafanaDashboard` (`grafana.dashboards.mode: operator`) or as sidecar ConfigMaps (`mode: sidecar`). Guide: `docs/13-observability.md`. Verified: all dashboard queries against a real Prometheus; not yet verified on the live cluster. Not done: frontend metrics
- [x] 29. Faster PDFs (PR `perf/invoice-pro-fork-update`): vendored fork updated to upstream `main` @ 1e203c7 (fork tag `v0.5.0-pdfcraft.4`); the `item` scope no longer uses `loom.mutator.batch` (23 items: ~197 -> ~147 ms, identical PDF); `line-items/table.typ` no longer measures every compact entry for `keep-together` (listed in `FORK.md`); start-up warm-up now compiles the real invoice template (first request ~230 ms -> warm). Warm compile of a 3-item invoice with embedded fonts: ~63 ms; with the dev machine's system fonts ~120 ms before the change and ~100 ms after (typst-as-lib re-reads each system font file per `World::font` call, +~35 ms in dev, no effect in the Docker image). Remaining time is the `loom` tree walk (eval ~33 ms) and layout (~23 ms); profile with `typst-timing` (`enable()`/`export_json`)
- [x] 30. Lean template (PR `perf/lean-template`, stacked on `perf/invoice-pro-deeper`): invoice-pro/loom are gone from the pipeline. `frontend/src/template/invoice.typ` only lays out data (imports just `@preview/sepay` for the EPC QR); `backend/src/einvoice.rs` computes totals/display texts and generates the EN16931/XRechnung XML (identical to invoice-pro's output), attached via `pdf.attach` (`assets.xml`); problems -> `invoice-draft.xml` (logged as `einvoice_draft`, no box in the PDF). Render ~8 ms (3 items) vs ~65 ms, 60 items ~37 ms. Verified with Mustang 2.26.0 (both profiles valid, PDF/A-3b). Vendored invoice-pro/loom/letter-pro removed. Keep `einvoice.rs`, `invoice.rs`, `validate.ts` and the template aligned
- [x] 32. Document types (PR `feat/document-types`): dashboard with tiles (`#/` hash routes: `#/invoice`, `#/credit-note`, `#/offer`, `#/order`, `#/delivery-note`, `#/letter`); `frontend/src/lib/documents.ts` (`DOC_SPECS`) drives the tiles and the generic `DocumentForm`; `Workspace` = form + live preview + download for every type; shared settings (sender, logo, design), per-type drafts in `localStorage` `pdfcraft.documents`. Backend `POST /v1/documents` (`backend/src/documents.rs`, templates `document-common.typ` + `<type>.typ`); credit notes show negative amounts and carry an e-invoice XML since step 33. Not done: German-only form labels for English documents
- [x] 31. Branding (PR `feat/logo-branding`): logo `frontend/public/logo.svg` (source, transparent background); derived favicon set, `site.webmanifest`, `logo-mark.png`, `logo-wide.png` (README + landing hero, tilted sticker), `og-image.png`; brand colors navy `#241259` / orange `#F25D39` / violet `#4A2FB0`; modernized landing page (`landing.css` rewritten, badges, steps, cards) and configurator form styling (section cards, rounded inputs, orange header CTA). Regenerate the derived images when `logo.svg` changes (see `docs/07-demo-system.md`)
- [x] 33. Archive, bulk, credit-note XML (PR `feat/bulk-archive-credit-xml`, stacked on `feat/document-types`): `einvoice::prepare(..., credit_for)` emits TypeCode 381 + `InvoiceReferencedDocument` (positive amounts; Mustang 2.26.0 valid); `documents::build` attaches it for credit notes; `POST /v1/documents/bulk` (ZIP, one rate-limit token per document, metrics endpoint `<type>-bulk`). Frontend: `lib/archive.ts` keeps downloaded documents in `localStorage` `pdfcraft.archive` (final snapshots, auto-incremented numbers), dashboard lists them with bulk ZIP and archive export/import (`pdfcraft-archive.json`, `archiveVersion` 1; each entry keeps the sender/design settings of its issue time without the logo; a GoBD notice is shown above the archive (it is NOT a compliant archive); several credit notes per invoice are allowed (badge "credit note issued"); free-token watermark is "Entwurf"/"Draft" by document language; the form warns when a number was already issued for that type (`duplicateNumberIssue`); bulk ZIPs are requested per distinct snapshot (several ZIP files if they differ) and use the current logo), "Stornieren" and follow-up prefill (`FOLLOW_UPS` in `documents.ts`). Archive stays in the browser (no server retention)
- [x] 34. Bilingual UI (on PR `feat/bulk-archive-credit-xml`): `frontend/src/lib/i18n.ts` (`tr(de, en)`, `useLang()`, localStorage `pdfcraft.lang`), DE/EN switch in the header. UI language and document language (`settings.locale`, handled by `t()` in the Typst templates) are independent. New UI strings must use `tr(...)`; label constants are getters, not import-time values
- [x] 35. DIN 5008 layout (Form B): `invoice.typ` and `document-common.typ` (shared by all other types) have margins 25/20/20 mm (left/right/bottom), address field from 45 mm, reference line at ~98.5 mm, fold marks (105/210 mm, 4 mm) and punch mark (148.5 mm, 8 mm) in the page `background` (together with the watermark), `%` with non-breaking space (`einvoice.rs`), letter signature space 14 mm. Tests `renders_invoice_with_and_without_watermark` / `renders_every_document_type` render all types with and without watermark (`PDF_OUT=<dir>` writes the PDFs). Keep both templates aligned; mentioned on the landing page and in README/docs. Not certified; the exact standard text was not available offline (e.g. reference line at 98.5 mm instead of 8.04 cm, which would overlap the address field)
- [x] 36. Friendly errors (PR `feat/friendly-errors`): `frontend/src/lib/apiErrors.ts` translates backend error codes and `validation_error` details (field paths + rule texts) into German/English sentences; used by `lib/api.ts`. New backend validation messages/codes need a translation there. The API responses stay English and unchanged. Form validation UX: every form input has a field key (backend path without `invoice.`/`document.`, e.g. `recipient.name`, `items[0].price`, `settings.bank.iban`) passed as `field` to `Field`/`TextField`/`TextAreaField` (`components/Field.tsx`, `FormIssues.tsx`); `validate.ts` (`requiredIssues` mirrors the backend's required rules and blocks the render request, `validateInvoice` = non-blocking e-invoice hints) and backend `ValidationError`s (`lib/api.ts`) become one deduplicated `Issue[]` in `Workspace.tsx`: one clickable summary (jumps to the field, also across tabs/mobile views), red border + inline message only after a field was touched, reported by the backend, or after a download attempt, tab badges with error counts. New fields need a `field` key plus an entry in `apiErrors.ts` (`settingsField`/`documentField`/`itemField`)
- [x] 37. Faster PDFs II (PR `perf/preload-fonts`): the backend loads embedded + system fonts once into memory (`load_fonts()` in `main.rs`, `typst-kit` as direct dependency) instead of `search_fonts_with`, which re-read and re-parsed the font file on every `World::font` call (this also affected the Docker image, which installs system fonts; the note in step 29 was wrong). Warm render of a 3-item invoice 21 -> 5 ms, 60 items 122 -> 28 ms (identical PDF size). `facturx::add_facturx_xmp` skips the lopdf parse when no `factur-x.xml`/`xrechnung.xml` name occurs in the PDF. Benchmark: `cd backend && cargo test --release bench_render -- --ignored --nocapture`. Tried and rejected: `lto = "fat"` + `codegen-units = 1` (no measurable gain, 8 min build). Remaining time: Typst layout (~3 ms / ~18 ms) and PDF export (~1.5 ms / ~3 ms)
- [x] 38. Internetmarke (PR `feat/internetmarke`, replaces docs-only PR #84): users buy Deutsche Post stamps with their **own** Portokasse login (model A, no reseller); `backend/src/internetmarke.rs` (`GET /v1/postage/products`, `POST /v1/postage/stamps`, 1 / 5 rate-limit tokens, feature flag `INTERNETMARKE_ENABLED`, `INTERNETMARKE_CLIENT_ID/SECRET` app credentials) and `postage.rs` (PNG check, sizing, asset `postage`). **No customer data stored:** the Portokasse login/token/stamp live only in the request (no `Debug` on `Credentials`, never logged), Valkey holds only a hashed 15 min request marker; the stamp PNG lives in the browser draft and is cleared after the PDF download (single-use; the archive keeps voucher id/product/price only). free tokens (watermarked drafts) can use the Post test API via `INTERNETMARKE_SANDBOX_*` (optional shared test login, no user login; `mode_for` in `internetmarke.rs`, products response `sandbox`/`loginRequired`; mock-verified only), `POST /v1/postage/stamps/recover` (fetches a paid-but-undelivered order again via `GET /app/shoppingcart/{id}`, 2 tokens, button "Fetch paid stamp again"; mock user `lost@example.com` simulates the failure), `POST /v1/postage/stamps/bulk` (PR `feat/postage-bulk`, stacked: up to 25 stamps, one cart, `4 + n` tokens); `backend/tools/mock_internetmarke.py` is a local mock of the Deutsche Post APIs (plain http only for loopback URLs). Optional `postage` field on `/v1/invoices` and `/v1/documents`; `invoice.typ`/`document-common.typ` place it in the address field. Frontend: `components/PostageSection.tsx`, `lib/postage.ts`. Metric `pdfcraft_postage_stamps_total{result}` (business dashboard). `reqwest` added. Guide: `docs/14-internetmarke-integration.md`. NOT verified: live Deutsche Post sandbox/production (product filter, field names, download host), whether partners may use end-customer Portokasse logins, a physical print test. New `postage_*` error codes need a translation in `apiErrors.ts` Stamp sizes are placed 1:1 from the PNG (px/dpi); reference sizes 37x20 / 62x20 / 62x32.5 mm come from the third-party dataset gruncellka/porto-data (not an official Post spec) and are pinned in a `postage.rs` test; tall stamps grow the address block in the templates. API spec v1.30 was compared with the client (matches). Docker Compose: optional `mock-post` service (profile `mock`, shares the backend network namespace because http is only allowed for loopback); Verified with `docker compose --profile mock up --build` (API level, not the browser flow behind Anubis). Docs: `docs/14` ("Trying it out"), `docs/06` (go-live checklist).
- [x] 39. Signature image + PDF signature research (PR `feat/signature-image`): `settings.signature` (`{fileName, mimeType, base64}` like the logo; PNG/JPEG/SVG/PDF, 300 KB, detected by content in `invoice.rs::check_signature`), asset `assets.signature`, printed below the closing text by `invoice.typ`/`document-common.typ` (letters: `letter.typ` between closing and name; ≤ 15 x 60 mm). Typst cannot embed PDFs in PDF/A exports, so `backend/src/signature.rs` converts a PDF to SVG (`hayro-svg`) and crops the `viewBox` to the visible content (resvg probe). Like the logo, the signature is excluded from archive snapshots. Tests: `renders_every_document_type_with_a_signature` (PNG, SVG, PDF), `signature::tests`. Research in `docs/15-pdf-signatures.md`: TLS/domain certificates cannot be used for PDF signatures (key usage/EKU, no AATL/EUTL trust; pyHanko experiment), real options are document-signing/eIDAS certificates; a digital signature is NOT implemented and not required for e-invoices
- [x] 40. Code review/cleanup (PR `refactor/code-review`): `v1.rs` handlers share `pdf_response`/`zip_response`/`render_all`/`prepare_document` (document bulk now renders in parallel like invoice bulk: 20 invoices 121 -> 91 ms with 2 cores, 20 x 60 items 564 -> 371 ms); warm-up moved to `v1/warm_up.rs`; `Kind::template()` is built once (`&'static str`); the request's virtual Typst files are removed by a `Drop` guard (`VirtualFiles` in `main.rs`, also after a panic); ZIP names are always unique. Measured and rejected: caching the parsed minijinja template (parse ~0.1 ms of ~5 ms). Clippy warnings fixed except `store.rs` type/enum-size notes and `signature.rs` `chunks_exact`
- [x] 41. Mollie instead of Stripe (PR `feat/mollie-payments`): `backend/src/stripe.rs` is replaced by `backend/src/mollie.rs`. `POST /v1/checkout` (`{plan, days, subscription?, tokenId?, locale?}`, public, only offers in `PAID_PRICES=plan:days=amount`) creates a Mollie payment (metadata `plan/days/order/token_id/subscription`) and returns `checkoutUrl` + `order`; Mollie calls `POST /v1/mollie/webhook` with only `id=tr_…` (unsigned), so the backend fetches the payment with `MOLLIE_API_KEY` and trusts only that (idempotent per payment id via Valkey markers); paid -> token created (claim by `GET /v1/tokens/claim?order=…`, renamed from `session_id`) or extended by `token_id`. Subscriptions: first payment (`sequenceType=first`, empty Mollie customer) -> after paid the backend creates a Mollie subscription (start date = today + days, metadata holds the token id); each paid `recurring` payment extends the token to now + days + `PAID_GRACE_DAYS`. Config: `MOLLIE_API_KEY`, `MOLLIE_API_URL` (override; http only on loopback), `PUBLIC_URL`, `MOLLIE_REDIRECT_URL`, `PAID_PRICES`, `PAID_CURRENCY`; Helm `backend.mollieSecret`; metric `pdfcraft_mollie_events_total` (replaces the Stripe one, dashboard updated); guide `docs/12-paid-tokens-mollie.md`; local mock `backend/tools/mock_mollie.py`. Verified with the mock + Valkey (one-off, renewal by token id, subscription + renewal, duplicate webhooks), NOT against live Mollie. Not done: per-IP rate limit on `/v1/checkout`, privacy policy wording is a placeholder until go-live (frontend purchase UI and cancelling: step 42)
- [x] 42. Purchase UI (PR `feat/purchase-ui`, stacked on `feat/mollie-payments`): Mollie is active only when `Config::mollie_enabled()` (= `PAID_TOKENS_ENABLED` + `MOLLIE_API_KEY` + `PUBLIC_URL` + `MOLLIE_REDIRECT_URL` + non-empty `PAID_PRICES`); otherwise checkout/webhook/claim/offers/cancel answer `404` (`ensure_enabled` in `mollie.rs`; before this PR a missing key gave 503). New endpoints: `GET /v1/checkout/offers` (public, `{enabled:false}` when off), `GET /v1/token` (calling token info), `POST /v1/subscription/cancel` (paid token; deletes the Mollie subscription; the `customer/subscription` ids sit in Valkey `pdfcraft:mollie:sub-of:<token id>`; metric event `cancel`). Frontend: `components/BuyPage.tsx` (`#/buy`) + `lib/purchase.ts`; nav link and route appear only when offers are enabled (`useOffers()`); the paid token lives in `localStorage` `pdfcraft.paidToken` and `lib/api.ts` prefers it over the free token (falls back after a 401); pending order in `pdfcraft.pendingOrder`, `?order=` from `MOLLIE_REDIRECT_URL` is handled by `handlePaymentReturn()` and the page polls the claim (claim is single-use; parallel calls share one request); renewal via `tokenId` checkout. Verified with the mock + Valkey + browser (DE/EN, dark, narrow; buy, claim, cancel, hidden when disabled), NOT against live Mollie. Not done: legal texts for the shop (step 43)
- [x] 43. Shop legal texts (PR `feat/shop-legal-texts`, stacked on `feat/purchase-ui`): `frontend/agb.html`, `frontend/widerruf.html` (Vite inputs, footer links on the landing page), Mollie paragraph in `datenschutz.html`; `BuyPage.tsx` needs two consent checkboxes (terms; immediate start + loss of withdrawal right) and the buttons say "Zahlungspflichtig kaufen/verlängern". Drafts, NOT reviewed by a lawyer; controller/seller is maltina.pro UG (haftungsbeschränkt) i. G., Erkrather Str. 401, 40231 Düsseldorf (Vorneweg only supports and hosts the cluster; imprint, privacy policy, terms, withdrawal and landing page say so, jurisdiction Düsseldorf); open: managing director/register/VAT ID in the imprint, VAT wording, arbitration statement, order confirmation on a durable medium (§ 312f BGB, no e-mail collected), consent is not recorded server-side
- [x] 44. Compose Mollie mock (PR `feat/compose-mollie-mock`, stacked on `feat/shop-legal-texts`): Compose profile `mock` also starts `mock-mollie` (shares the backend network namespace, exposed by `edge` under `/mock-mollie/`); `backend/tools/mock_mollie.py` serves a fake checkout page (Pay/Cancel, redirects to `redirectUrl`) and an index with "Simulate renewal" (env `MOCK_MOLLIE_HOST`, `MOCK_MOLLIE_PUBLIC_URL`). Run: `docker compose --env-file deploy/compose/mock-mollie.env --profile mock up --build`, app at http://localhost:8080/app/. Guide: `docs/12` ("With Docker Compose"), `docs/03`
- [x] 45. Pricing (PR `feat/pricing-offers`, stacked on `feat/compose-mollie-mock`): no day pass; suggested launch offers `starter:31=2.90,starter:365=24.00,business:31=9.90` (later 4.90 / 39.00 / 14.90; running subscriptions keep their amount because the Mollie subscription holds it), set only via `PAID_PRICES` (see `docs/12` "Pricing"); year label on the buy page, mock env uses the new prices. Mollie's maximum subscription interval is `365 days` (official SDK docs), so the yearly offer may be a subscription, nothing longer. Not reviewed by a tax advisor/lawyer: VAT/small-business rule (§ 19 UStG), and buyers get no invoice for the purchase (no customer data is collected; Mollie sends none)
