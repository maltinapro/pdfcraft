# Code Review (E12)

Written report of the review in epic [E12](epics/E12-code-review.md) (E12-01, [#191](https://github.com/maltinapro/pdfcraft/issues/191)). It decides the order of the other E12 issues. Behavior and API are unchanged by the review itself; every fix is a separate, small PR.

- **Reviewed:** `main` after #208 (commit `a3e5db9`), 16 Nov 2026. Both code bases were read against the checklist from the epic. Numbers below were measured on that commit with the commands in [Measuring](#measuring); the baseline in the epic (15 Nov 2026) is quoted where it changed.
- **Severity:** **H** = a security exposure, or a failure or gap in a critical path that would stay invisible in production. **M** = real maintenance, quality or robustness risk. **L** = small, cheap or cosmetic.
- **Action:** the issue that fixes it (`E12-NN`), or `accepted: <reason>`. `E12-10` and `E12-11` are new sub-issues proposed by this review (see the [epic](epics/E12-code-review.md)); their GitHub issues are created from the epic file.
- **Not covered:** the render benchmark and the preview latency are not re-measured here (E12-07 owns them, see [Performance baseline](#performance-baseline)); nothing was verified against live Mollie, live Deutsche Post or a real cluster.

## Summary

| | H | M | L |
| --- | --- | --- | --- |
| Findings (41 in total) | 3 | 15 | 23 |

The three **H** findings:

1. **S-01** no security headers anywhere (E12-09).
2. **B-02** `store.rs` (tokens, rate limit, free-token markers) has no tests (E12-05).
3. **W-01** front-end errors are not counted, so a silent preview failure was only found by chance (E12-08).

Things that are in good shape and need no action: no `any` and no `@ts-ignore` in the frontend, `npm audit` reports 0 vulnerabilities, all outgoing HTTP calls have timeouts and disable redirects, Typst runs in `spawn_blocking` behind a semaphore with a queue timeout, secrets and customer data are not logged or stored, and the backend test suite is fast and free of timing-based tests.

## Resolution status

All findings were worked on in PR #209. Status by area (commits of that PR):

| Area | Findings | Status |
| --- | --- | --- |
| CI and tooling | T-01 (`cargo fmt --check`), T-02 (clippy `-D warnings`), T-03 (`cargo-deny`, `backend/deny.toml`), T-04 (oxlint instead of ESLint: TypeScript 7 has no JS API for typescript-eslint), T-05 (frontend lint/audit/test/build/budget in CI), T-06 (`npm run budget`), T-07, T-08 | Fixed |
| Dependencies | D-01 (`serde_norway`; `serde_yaml` stays as a transitive Typst dependency, ignored in `deny.toml` with reasons), D-02, D-04, D-05 | Fixed |
| Backend | B-01 (`block_in_place` for PDF to SVG), B-02 (`store.rs` tests, Valkey service in CI), B-03 (`v1`, `einvoice`, `internetmarke` split), B-04 (poisoned locks) | Fixed |
| Security and containers | S-01 (CSP and security headers in nginx, backend and edge), S-02 (non-root, read-only containers, Helm security contexts) | Fixed (base images pinned to distro/major tags, not digests) |
| Frontend | W-01 (`POST /v1/client-errors`, `pdfcraft_client_errors_total{kind,browser}`), W-02 (lazy routes; app chunk 374 to 254 kB), W-03 (`Workspace.tsx` 650 to 459 lines, e-invoice parser split; `App.tsx`, `BuyPage.tsx`, `SettingsForm.tsx` stay at 320 to 437 lines: accepted, they are single cohesive components), W-04, W-08, W-09, W-10, W-13, request timeouts | Fixed / accepted as noted |
| Tests | Q-01 (component tests with `react-dom/server`, no DOM dependency) | Fixed |

D-06 is done (dependency table in `docs/10`), as are the client-errors docs (`docs/13`), the technical dashboard panel and the privacy sentence. The render benchmark is re-measured (see Performance baseline). Not done or not verifiable here: preview latency and memory measurements, the E08 usability comparison and real-device checks. Remaining findings not listed above keep the action in the tables below.

## Measured baseline

| Item | Epic baseline (15 Nov) | Measured 16 Nov | Note |
| --- | --- | --- | --- |
| `npm outdated` | `swagger-ui-dist` 5.34.1 → 5.35.0 | same | only one package |
| `npm audit` (all / `--omit=dev --audit-level=high`) | 0 | 0 / 0 | |
| `cargo clippy --locked --all-targets` | 4 warnings | **5 warnings** | new: `map_flatten` in `invoice.rs` |
| `cargo fmt --check` | 230 hunks | **238 hunks in 15 files** | `internetmarke.rs` 59, `mollie.rs` 43, `store.rs` 28, `einvoice.rs` 23, `metrics.rs` 16, `main.rs` 16 |
| `cargo test --locked` | – | 59 passed, 1 ignored (benchmark), 4 s | |
| `cargo tree -d` | 3 families | **26 crate names listed more than once** | see [Dependencies](#dependencies) |
| `cargo update --dry-run` | patch updates only | 8 patch/minor updates (`redis` 1.8.2, `zip` 9.6.0, …) | Renovate lock maintenance covers them |
| Frontend tests | 5 files, 57 tests | **12 files, 80 tests** | all in `src/lib/`, no component tests |
| `npm run build` / `npm test` | – | 1.0 s / 4 s | |
| Frontend ESLint | none | none | |

### Bundle baseline

`frontend/scripts/bundle-budget.mjs` (E12-03) compares against these numbers. Sizes are the minified file sizes reported by `npm run build` (kB, 1 kB = 1000 bytes).

| File | Size | gzip | Budget rule |
| --- | --- | --- | --- |
| `assets/app-*.js` | 373.96 | 116.63 | fail above **390 kB** (see T-06) |
| `assets/app-*.css` | 65.22 | 11.88 | fail above +10 % (71.7 kB) |
| `assets/landing-*.css` | 23.03 | 5.07 | fail above +10 % (25.3 kB); there is no landing JS |
| `assets/pdf-*.js` (lazy: preview, viewer) | 500.13 | 152.68 | fail above +10 % (550.1 kB) |
| `assets/pdf.worker.min-*.js` (lazy) | 1,327.59 | – | not budgeted (vendor file) |
| `assets/swaggerReference-*.js` + `.css` (lazy, `/api/`) | 1,507.82 + 191.88 | 423.22 + 27.83 | not budgeted (loaded on click) |
| `assets/ViewerPage-*.js` / `.css` (lazy) | 40.13 / 9.65 | 13.27 / 2.77 | fail above +10 %; the JS limit is 55.3 kB since the rule and code-list checks (`rules.ts`, 50.2 kB) |

### File sizes

| File | Lines | Note |
| --- | --- | --- |
| `backend/src/v1.rs` | 1,841 | 713 production + 1,127 test lines (`#[cfg(test)]` starts at line 714) |
| `backend/src/internetmarke.rs` | 843 | 634 production |
| `backend/src/einvoice.rs` | 728 | 694 production (not named in E12-05) |
| `backend/src/store.rs` | 586 | no tests |
| `backend/src/mollie.rs` | 565 | 528 production |
| `frontend/src/components/Workspace.tsx` | 654 | was 395 on 15 Nov (E08) |
| `frontend/src/App.tsx` | 434 | |
| `frontend/src/components/BuyPage.tsx` | 421 | |
| `frontend/src/lib/einvoice/parse.ts` | 419 | CII and UBL in one file |
| `frontend/src/components/SettingsForm.tsx` | 320 | |
| `frontend/src/App.css` | 883 | was 990 |

## Checklist results

Every point of the checklist in E12-01 has a result. The numbered findings are in the tables further down.

### React

| Point | Result |
| --- | --- |
| Effects with complete dependencies | No defect found by reading `Workspace.tsx`, `PdfCanvasPreview.tsx`, `BuyPage.tsx`, `App.tsx`. Not machine-checked: **T-04** adds `react-hooks/exhaustive-deps`; every finding there is fixed or explained in E12-03. |
| No state that can be derived | `Workspace.tsx` mirrors `pdfBlob` into `previewUrl` through an effect and resets `showAll` in an effect on `paused`. Both are small and correct (an object URL needs a cleanup); **accepted**. |
| No work in render | Only `find`/`filter` on lists of a few entries. `ArchiveList.tsx` uses `selected.includes(id)` per row (O(n·m)); the archive is a few hundred entries at most; **accepted**. |
| Stable keys | Editable lists use `item.id`. Index keys exist only in the read-only viewer lists (**W-11**, accepted). |
| Cleanup of timers, listeners, object URLs | Cleaned correctly in `Workspace`, `App` (save debounce), `Snackbar`, `Menu`, `ThemeToggle`, `router`, `useHideNavOnScroll`, `BuyPage` polling (cancel flag), `PdfCanvasPreview` (worker shared, task destroyed, failure URL revoked). Gaps: **W-04**, **W-05**. |
| Lazy chunks | pdf.js, viewer and Swagger UI are lazy. All app pages are in the main chunk (**W-02**). |

### TypeScript

| Point | Result |
| --- | --- |
| No `any` | None (`grep` for `: any`, `as any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`: no hits). Ten `as unknown as` casts remain (**W-07**). |
| Narrow types at boundaries | `parseConfig`, `parseDrafts`, `parseMasterData`, `validEntries` validate their input. Three `JSON.parse(...) as T` casts do not (**W-07**). |
| Strictness | `strict`, `noUnusedLocals`, `noUnusedParameters`; `npm run build` runs `tsc`. |

### CSS

| Point | Result |
| --- | --- |
| Tokens only after E07 | `tokens.css` holds 47 hex colors; the only other hex colors are 6 in `workspace.css` (**W-10**). |
| No dead rules | At least 12 selectors are never used (**W-09**). The rest of the unmatched names are built dynamically (`ui-button-*`, `ui-banner-*`, `xml-token-*`) and were checked by hand. |

### Rust

| Point | Result |
| --- | --- |
| No `unwrap`/`expect` on request paths | 21 production sites in total; 15 are startup, warm-up, spec-generation or invariant checks. The request-path ones are in **B-04**. `signature.rs` has none outside tests (the epic suspected it). |
| Typed errors mapped once to the JSON envelope | `ApiError` (`main.rs`) implements `IntoResponse`; handlers return `Result<_, ApiError>`; `v1.rs` builds the two auth/store responses through the same type. No defect. |
| Timeouts on every outgoing HTTP call | Mollie 15 s / connect 8 s, Internetmarke 20 s / connect 8 s, both with redirects disabled. Valkey: crate defaults (**B-05**, accepted). |
| No secrets in logs or `Debug` | `Credentials` (Portokasse login) has no `Debug`/`Clone`/`Serialize`; `Config` has no `Debug`; the `Debug` derives are on `Price`, `Product`, `Client` (no secrets), `Unavailable`. The access log writes route templates, status, timing and the non-secret token id/kind/plan only (`telemetry.rs`); log fields in `free.rs`, `mollie.rs`, `internetmarke.rs` carry no token, cookie value, password or body. No defect. |
| Bounded concurrency | Typst compilations: semaphore `MAX_CONCURRENT_COMPILES` plus `COMPILE_QUEUE_TIMEOUT_SECS` (503 `server_busy`). Bulk: at most the plan's maximum (≤ 100) tasks, all waiting on the same semaphore (**B-06**, accepted). Body limit 2 MB globally. |
| `spawn_blocking` for CPU work | Typst compile, PDF export and the Factur-X XMP step run inside `spawn_blocking`. The signature PDF→SVG conversion does not (**B-01**). |

### Security

| Point | Result |
| --- | --- |
| Input limits | 2 MB request body, per-field limits in `invoice.rs`, logo/signature 300 KB, bulk size per plan, assets ≤ 8 × 1 MB, postage PNG checked. No defect. |
| CORS | Default allows any origin when `CORS_ALLOWED_ORIGINS` is unset (**S-03**, accepted). |
| Headers | Missing (**S-01**). |
| Containers | Run as root, floating base images (**S-02**). |
| No customer data persisted | Valkey holds only hashed tokens, counters and hashed markers; no render or PDF cache exists; the Portokasse login and stamp live only in the request. No defect. |

### Tests

| Point | Result |
| --- | --- |
| Critical paths covered | Rendering, validation, e-invoice XML (plus Mustang in CI), OpenAPI, archive, master data, storage, e-invoice viewer are covered. Gaps: **B-02** (`store.rs`), **Q-01** (components). |
| No flaky timing | No test uses `sleep`, fake timers or wall-clock assertions; the backend suite finishes in 4 s. |

## Findings

### Tooling and CI

| ID | File | Finding | Sev. | Action |
| --- | --- | --- | --- | --- |
| T-01 | `backend/src/**` | `cargo fmt --check` fails with 238 hunks in 15 files; formatting is not enforced. | M | E12-02 (formatting-only PR first, then the CI step) |
| T-02 | `free.rs:96`, `invoice.rs:409`, `signature.rs:50`, `store.rs:218`, `v1.rs:965` | 5 clippy warnings (`explicit_auto_deref`, `map_flatten`, `chunks_exact_to_as_chunks`, `type_complexity`, `err_expect`). The epic listed 4; `map_flatten` is new. | M | E12-02 **Fixed** in the E12 findings batch, clippy runs in CI with `-D warnings`. |
| T-03 | `.github/workflows/ci.yml` | No clippy, fmt, advisory, license or duplicate check for Rust. (`cargo-audit` and `cargo-deny` are not installed in the dev environment, so advisories were not measured here.) | M | E12-02 (`cargo-deny`) |
| T-04 | `frontend/` | No ESLint: hook dependencies and accessibility rules are unchecked. | M | E12-03 |
| T-05 | `.github/workflows/ci.yml` | No `npm audit` step (currently 0 vulnerabilities). | L | E12-03 |
| T-06 | `frontend/` build | No bundle budget. `app-*.js` is 373.96 kB, already above the 360 kB limit the epic proposes (the page set grew since the 340 kB baseline). A 360 kB gate would fail on its first run. | M | E12-03 with the corrected initial limit of 390 kB; lower it after E12-06 splits the routes |
| T-07 | `frontend/tsconfig.tsbuildinfo` | A build artifact is tracked in git although `tsconfig.json` has `noEmit`. | L | E12-11 **Fixed** in the E12 findings batch (untracked, `*.tsbuildinfo` ignored). |
| T-08 | `frontend/vite.config.ts:11` | Uses `__dirname`; Vite warns about it on every build and test run. Use `import.meta.dirname`. | L | E12-11 **Fixed** in the E12 findings batch. |

### Dependencies

| ID | File | Finding | Sev. | Action |
| --- | --- | --- | --- | --- |
| D-01 | `backend/Cargo.toml`, `openapi.rs` | `serde_yaml` 0.9 is unmaintained. Replacing the direct use is not enough: `typst-library` and `hayagriva` depend on it as well, so it stays in the tree. `cargo-deny` needs an `ignore` entry with this reason until Typst drops it. | M | E12-04 |
| D-02 | `backend/Cargo.toml` | Duplicates caused by the project's own version choices: `hayro-svg` 0.9 (Typst's `typst-svg` uses 0.7) builds a second copy of the `hayro-*` family (6 crates); `usvg`/`resvg` 0.50 (Typst's `krilla-svg`/`typst-library` use 0.47); `tower-http` 0.7 (`reqwest` uses 0.6); `base64` 0.23 (`krilla` and `hayro-svg` use 0.22). | M | E12-04 (align on Typst's versions where the API allows; note binary size and build time before/after) |
| D-03 | transitive | Duplicates that come from the Typst/krilla/hayro stack and are not removable from here, for example `rand` 0.8 (via `lipsum`), `quick-xml`, `skrifa`/`read-fonts`, `miniz_oxide`, `num-bigint`, `roxmltree`, `weezl`, `syn` 2/3, `imagesize`. | L | accepted: upstream versions; re-check at every Typst update |
| D-04 | `backend/Cargo.toml:8` | `tokio` uses `features = ["full"]`; the code uses `rt-multi-thread`, `macros`, `net`, `time`, `sync` (no `fs`, `process`, `signal`). | L | E12-04 **Fixed** in the E12 findings batch. |
| D-05 | `frontend/package.json` | `swagger-ui-dist` 5.34.1 → 5.35.0. | L | E12-04 **Fixed** in the E12 findings batch. |
| D-06 | `docs/10` | No table that says why each runtime dependency exists. | L | E12-04 **Fixed**: table in `docs/10`. |
| D-07 | transitive (`syntect` → `yaml-rust`) | `yaml-rust` 0.4 is old and unmaintained. Only reachable through Typst. | L | accepted: transitive; `cargo-deny` reports it, with an ignore entry that names this review |

### Security

| ID | File | Finding | Sev. | Action |
| --- | --- | --- | --- | --- |
| S-01 | `frontend/nginx.conf`, `deploy/compose/`, `deploy/helm/pdfcraft/templates/` | No `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy`. Note for the fix: nginx inherits `add_header` from the `server` block only into locations that define none, so the `add_header Cache-Control` in `location /assets/` would drop the security headers there; they have to be repeated (or set with an include) in that location. | **H** | E12-09 **Mostly fixed** in the E12 findings batch for the frontend nginx image (`frontend/security-headers.conf`); still open for backend responses, the Compose `edge` proxy and the Helm Ingress. |
| S-02 | `backend/Dockerfile`, `frontend/Dockerfile`, `deploy/helm/pdfcraft/` | Containers run as root (no `USER`), the Helm chart sets no `securityContext` (non-root, read-only root filesystem, no privilege escalation, dropped capabilities), and the base images float (`rust:1-slim`, `debian:stable-slim`, `nginx:alpine`, `node:26-slim`). | M | E12-10 (new) |
| S-03 | `backend/src/config.rs:242` | When `CORS_ALLOWED_ORIGINS` is unset the API allows any origin. | L | accepted: authentication is a bearer token in a header (no cookies, `allow_credentials` is not set), the app is served same-origin, and `docs/04`/`06` document the setting |
| S-04 | `backend/src/mollie.rs` | `POST /v1/checkout` has no per-IP rate limit (known, `AGENTS.md` step 41). Each call creates a Mollie payment. | L | accepted: purchases are off by default; revisit with the go-live checklist in `docs/06` |

### Backend

| ID | File | Finding | Sev. | Action |
| --- | --- | --- | --- | --- |
| B-01 | `signature.rs`, `invoice.rs:316` | `pdf_to_svg` parses an untrusted PDF and rasterizes a probe image synchronously in request validation, on an async worker thread, outside `spawn_blocking` and outside the compile semaphore. It runs on every request with a PDF signature, including every live preview update (nothing may be cached). `catch_unwind` guards a panic, not time. | M | E12-05 (run it in `spawn_blocking` inside the same concurrency bound; measure a worst-case signature) |
| B-02 | `store.rs` (586 lines) | Token hashing, the Lua token bucket, free-token markers, cluster mode and the token index have no tests; `mollie.rs` webhook idempotency and subscription renewal are only tried against the mock. A regression would hit authentication and billing. | **H** | E12-05 (Valkey service container in CI, skipped without `VALKEY_URL`) |
| B-03 | `v1.rs`, `internetmarke.rs`, `einvoice.rs` | Production code above ~600 lines: `v1.rs` 713 (plus 1,127 test lines), `internetmarke.rs` 634, `einvoice.rs` 694. `einvoice.rs` is not named in E12-05. | M | E12-05 (scope amended to include `einvoice.rs`; `mollie.rs` at 528 lines is within the limit) |
| B-04 | `main.rs:63,70`, `internetmarke.rs:195,216`, `v1.rs:126`, `mollie.rs:127` | Request-path `unwrap`/`expect`: the Typst file resolver uses `lock().unwrap()` while its own `Drop` guard uses the poison-tolerant `locked()` helper; the Internetmarke product cache uses `lock().unwrap()`; `"Bearer".parse().unwrap()` is a constant; the HTTP client `expect` runs at first use inside a `OnceLock`. None can fail in practice, but one poisoned lock would turn every later request into a panic. | L | E12-05 |
| B-05 | `store.rs`, `config.rs` | Valkey calls rely on the crate's defaults (single connection: 500 ms response, 1 s connect). The cluster client was not checked. | L | accepted: defaults are short and failures map to `503 store_unavailable`; the E12-05 Valkey tests include an unreachable-store case |
| B-06 | `v1.rs` `render_all` | Bulk spawns one task per entry (at most the plan maximum, ≤ 100); all wait on the compile semaphore. | L | accepted: bounded by the plan maximum; at about 10 ms per document the queue stays far below the 10 s timeout |

### Frontend

| ID | File | Finding | Sev. | Action |
| --- | --- | --- | --- | --- |
| W-01 | `lib/api.ts`, `PdfCanvasPreview.tsx` | Front-end errors are not counted anywhere. The preview worker leak and the blank Android preview (#158, #159) were found by chance, not by a signal. | **H** | E12-08 |
| W-02 | `App.tsx` | Every page (`BuyPage`, `MasterDataPage`, `DataPage`, `DocumentsPage`, `Workspace`, forms) is imported eagerly; only the viewer and the PDF canvas are lazy. This is why the app chunk is 374 kB. | M | E12-06 (route-level `lazy()` while splitting `App.tsx`) |
| W-03 | `Workspace.tsx` 654, `App.tsx` 434, `BuyPage.tsx` 421, `SettingsForm.tsx` 320, `lib/einvoice/parse.ts` 419 | Files above ~300 lines. `Workspace.tsx` grew by 260 lines through E08. | M | E12-06 (waits for E08; add `SettingsForm.tsx` to its list) |
| W-04 | `App.tsx` (4×), `BuyPage.tsx`, `Workspace.tsx` | The create-object-URL, anchor click, revoke sequence exists six times. `App.tsx` and `BuyPage.tsx` revoke right after `click()`, `Workspace.tsx` waits 1 s; revoking immediately can cancel the download in some browsers. | M | E12-11 (one `downloadBlob()` helper with the delayed revoke) **Fixed** in the E12 findings batch (`lib/download.ts`). |
| W-05 | `ArchiveList.tsx:41`, `App.tsx:148` | The long-press timer is not cleared when the list unmounts; the bulk ZIP loop waits up to 3 × 60 s for the rate limit and cannot be cancelled. | L | E12-11 |
| W-06 | `lib/api.ts`, `lib/purchase.ts` | `fetch` calls have no timeout. A hanging connection leaves the preview spinner forever (the backend answers 503 after 10 s of queueing, but a dead connection never answers). | L | E12-11 (`AbortSignal.any` with `AbortSignal.timeout`) |
| W-07 | `lib/api.ts:33,69`, `lib/purchase.ts:51`, `lib/storage.ts`, `lib/documents.ts` | Three `JSON.parse(...) as T` casts on `localStorage` data without validation (token, pending order); ten `as unknown as` casts (eight of them in the config/draft merge, which merges by structure and does not check field types). | L | E12-11 for the three casts; the merge is **accepted**: the backend validates every field and shows the error in the form |
| W-08 | `lib/archive.ts:78,88` | Deep copy through `JSON.parse(JSON.stringify(...))`. | L | E12-11 (`structuredClone`) **Fixed** in the E12 findings batch. |
| W-09 | `App.css`, `workspace.css`, `pages.css`, `ui.css`, `landing.css` | Never referenced: `.app-subtitle` (4 rules), `.crumb-sep`, `.is-paused`, `.mobile-switch`, `.preview-frame`, `.view-form`, `.view-preview`, `.lang-toggle`, `.btn-danger`, `.master-row-actions`, `.ui-button-link`, `.todo`. | L | E12-06 |
| W-10 | `components/workspace.css:214-222` | Six hex colors (XML token highlighting) outside `tokens.css`. | M | E12-06 (its acceptance criterion: no hex color outside `tokens.css`) |
| W-11 | `EInvoiceView.tsx`, `EInvoiceChecks.tsx`, `Workspace.tsx:646` | Index keys in read-only lists of the viewer and the XML view. | L | accepted: the lists are never reordered or edited |
| W-12 | `lib/*.ts` | 38 `catch {}` blocks swallow storage errors; one `console.error` (preview failure). | L | accepted: private-mode or full storage is expected and reported through the save state; preview failures get counted by E12-08 |
| W-13 | `PdfCanvasPreview.tsx` | Canvases of replaced pages are dropped without `canvas.width = 0`, which iOS Safari needs to release the memory. | L | E12-07 (already listed there: memory after 50 updates) |
| W-14 | `swaggerReference-*.js` 1.5 MB, `pdf.worker` 1.3 MB | Large chunks. | L | accepted: both load lazily (button/hash on `/api/`, first preview), Lighthouse mobile stays at 100 on `/api/` (`AGENTS.md` step 56) |

### Tests

| ID | File | Finding | Sev. | Action |
| --- | --- | --- | --- | --- |
| Q-01 | `frontend/src/**` | No component tests: all 12 test files are in `src/lib/`. `Field.tsx`, `FormIssues.tsx`, `Workspace.tsx` issue handling and the zone state are untested. | M | E12-06 |
| Q-02 | `docs/`, browser flows | No automated end-to-end test; the screenshot script is a visual check, the usability comparison is manual by design (`docs/16`). | L | accepted: covered by the visual verification and device matrix rules |

## Performance baseline

Rendering re-measured on 16 Nov 2026 after the E12 changes (release build, `bench_render`). Preview latency, memory, and the "after E08" column still need a manual run.

| Measurement | Baseline source | Value | After E08 |
| --- | --- | --- | --- |
| `bench_render`, 3 items | `AGENTS.md` step 37, step 57 | ~5 ms (Classic 8.5 / Modern 10.4 / Contrast 11.5 ms with the E11 designs) | Classic 8.9 / Modern 10.6 / Contrast 11.7 ms (within noise) |
| `bench_render`, 60 items | same | ~28 ms (Classic 39.5 / 40.0 / 42.1 ms) | Classic 39.1 / Modern 38.6 / Contrast 40.9 ms; bulk 20 x 60 items 422 / 419 / 427 ms parallel |
| Preview latency, 4× CPU throttling, 390 px | – | open | open |
| Memory after 50 preview updates | – | open | open |
| Lighthouse mobile, `/` and `/api/` | `AGENTS.md` step 56 | 100 / 100 | open |
| Lighthouse mobile, `/app/` | – | open | open |

Commands: `cd backend && cargo test --release bench_render -- --ignored --nocapture`; for the preview, Chrome DevTools with CPU 4× slowdown at 390 px.

## Order of work

1. **E12-09** (S-01, H), **E12-08** (W-01, H) and **E12-05** (B-02, H, plus B-01, B-03, B-04) first; they close the three H findings.
2. **E12-02** and **E12-03** next: they make the rest enforceable. The formatting PR goes first and contains only formatting.
3. **E12-04** (D-01, D-02, D-04 … D-06), **E12-10** (S-02) and **E12-11** (W-04 … W-08, T-07, T-08).
4. **E12-06** after E08 and E09 are finished (W-02, W-03, W-09, W-10, Q-01); **E12-07** before and after E08.

## Measuring

```bash
# backend (from backend/)
cargo fmt --check
cargo clippy --locked --all-targets
cargo test --locked
cargo tree -d --locked
cargo update --dry-run

# frontend (from frontend/)
npm ci
npm outdated
npm audit
npm test
npm run build            # bundle sizes
```

Line counts exclude nothing except where a test module is named; production lines are the lines before the first `#[cfg(test)]`.
