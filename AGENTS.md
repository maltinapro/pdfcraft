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

## Factur-X XMP post-processing
Typst/krilla writes its own XMP and cannot be extended (not fixable in the invoice-pro fork). `backend/src/facturx.rs` (lopdf) adds the `fx:` extension schema + `DocumentFileName/DocumentType/Version/ConformanceLevel` to the PDF's XMP when `factur-x.xml`/`xrechnung.xml` is attached (not for `invoice-draft.xml`); on any failure the unmodified PDF is returned. Verified with Mustang 2.26.0: `Parsed PDF:valid XML:valid`.

## Notes for Next Work
- Do not add caches of rendered templates or generated PDFs (customer data).
- Frontend serializer and backend template language should stay aligned.
- Add new form fields in `types.ts` + `backend/src/invoice.rs` (validate/escape; the frontend sends raw form values) + the form + `invoice.typ`. User data goes only into Typst string literals (escape `\` and `"`).
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
  - Validated with Mustang 2.26.0: embedded XML valid (EN16931), PDF/A-3b compliant. Remaining known limitation: missing Factur-X XMP metadata (PDF-level ZUGFeRD validators report it); XRechnung-only rules (BR-DE-5/6/21/27, seller contact) are notices, not errors. XMP gap is now fixed in the backend (see below)
- [x] 5. invoice-pro fork (PR `feat/invoice-pro-fork`): https://github.com/maltinapro/invoice-pro (fork of leonieziechmann/invoice-pro, MIT). Branch `pdfcraft` based on upstream tag `v0.5.0` (NOT upstream `main`, which has unreleased API changes), tag `v0.5.0-pdfcraft.1`; `FORK.md` documents source/changes, upstream `LICENSE` stays unchanged. Vendored copy in `backend/vendor/typst-packages/preview/invoice-pro/0.5.0` (+ `FORK.md`). Workflow for template changes: commit in fork, tag `v0.5.0-pdfcraft.<n>`, re-copy into vendor, list the change in `FORK.md`. Fork must be created manually (session token cannot fork/create repos)
- [x] 6. XRechnung profile + fork on upstream `main` (PR `feat/xrechnung-profile`): fork branch `pdfcraft` = upstream `main` @ 794f21d + `FORK.md`, tag `v0.5.0-pdfcraft.2` (still vendored as `invoice-pro/0.5.0`; API differs from released 0.5.0: `theme.classic.with(theme.custom.brand(..))`, `payment-terms`). Form: `settings.einvoiceProfile` (`en16931`/`xrechnung`) and `sender.contactName`; template emits `sender.contact`; XRechnung attaches `xrechnung.xml`. Mustang: both profiles valid, BR-DE-5/6/15/21/27 satisfied with the XRechnung profile + contact + phone + buyer reference
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
- [x] 26. Purchased tokens via Stripe (PR `feat/paid-token-stripe`, stacked on `feat/frontend-free-token`): `backend/src/stripe.rs`: `POST /v1/stripe/webhook` (HMAC signature, `checkout.session.completed` creates or extends by `metadata.token_id`, `invoice.paid` subscription renewal to period end + `PAID_GRACE_DAYS`), one-time `GET /v1/tokens/claim?session_id=`; everything `404` unless `PAID_TOKENS_ENABLED=true`, needs `STRIPE_WEBHOOK_SECRET`. Only the token hash/plan/end date is stored. Tested with signed fake events, NOT against live Stripe. Guide: `docs/12-paid-tokens-stripe.md`
