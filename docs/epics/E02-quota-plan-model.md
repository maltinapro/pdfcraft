# E02 – Quota and plan model (backend)

**Phase:** 0 · **Depends on:** E00 · **Business plan:** section 5 · **Status:** open

## Goal
The plan sells monthly quotas ("300 documents/month", "5,000 / 50,000 API calls/month") and a priority tier. Today only a per-minute rate limit exists, stored with the token at creation. This epic adds plans with monthly quotas, metering, priority and usage reporting in the backend, without storing customer data.

## Context / links
- `backend/src/store.rs` (hashed tokens, token bucket in Valkey), `backend/src/config.rs` (`PAID_PLANS`, `BULK_MAX_BY_PLAN`), `backend/src/v1.rs` (handlers, compile semaphore, `COMPILE_QUEUE_TIMEOUT_SECS`), `backend/src/metrics.rs`.
- [05 Tokens and Rate Limiting](../05-tokens-and-rate-limiting.md), E00-03, E00-04.

## Definition of done
- A token has a plan with rate limit, monthly quota, bulk maximum, priority and feature flags; all `/v1` endpoints meter against it.
- Clients can read their usage; exceeding the quota gives a clear, translated error.
- Existing tokens keep working; tests and dashboards cover the new behavior.

## Issues
- [ ] **E02-01 Plan catalog** – Extend `PAID_PLANS` (or a new `PLANS` setting) with monthly quota, bulk max, priority and scope (web/API/both) per plan, backward compatible with the current `name=limit` syntax. AC: config parsing tests; docs in `04` and `05`; defaults unchanged.
- [ ] **E02-02 Monthly metering** – Count documents per token and period in Valkey (atomic increment with expiry, together with the rate-limit check, Lua). Cost: 1 per rendered document, `n` per bulk, as decided in E00-03. AC: two-instance test shows a shared counter; Valkey outage falls back as the rate limiter does (documented); no document content stored.
- [ ] **E02-03 Preview vs. final download** – Implement the E00-03 decision so the live preview does not consume the monthly quota but cannot be abused for free unwatermarked PDFs (for example a purpose marker with a separate preview allowance, or a preview rendering that is not a deliverable). AC: preview and download are distinguishable server-side; abuse test documented; the editor keeps its live preview.
- [ ] **E02-04 Quota errors and headers** – Answer `429 quota_exceeded` with `Retry-After` / reset time, and expose `X-Quota-Limit`, `X-Quota-Remaining`, `X-Quota-Reset` on `/v1` responses. AC: translation in `apiErrors.ts`; API reference updated; CORS exposes the headers.
- [ ] **E02-05 Usage in `GET /v1/token`** – Add period start/end, used, remaining and the plan's limits to the response. AC: documented in `09-api-reference.md`; used by E04.
- [ ] **E02-06 Priority tier** – Give the highest plan priority in the compile queue (for example a weighted/priority wait before `server_busy`) and a higher rate limit. AC: load test shows that a Scale token is served first under saturation while lower plans still make progress.
- [ ] **E02-07 Existing tokens** – The limit is stored with a token at creation. Decide and implement how existing tokens get plan changes (resolve the plan at request time, or a `tokens migrate` CLI command). AC: CLI `tokens create|extend` accept the new plan fields; migration tested on existing tokens.
- [ ] **E02-08 Metrics and dashboards** – Add `pdfcraft_quota_*` metrics (consumed, rejected, per plan; `token_id` label only for paid tokens). AC: business dashboard panels and `docs/13-observability.md` updated; queries verified against a real Prometheus.
- [ ] **E02-09 Docs and local trial** – Update `04`, `05`, `09`, `12`, Compose env files and the Helm values. AC: documented command shows quota exhaustion locally.

## Open questions
- Calendar-month reset or rolling period per token term (E00-03)?
- Should the free token also get a monthly cap to limit abuse beyond the per-minute limit?
