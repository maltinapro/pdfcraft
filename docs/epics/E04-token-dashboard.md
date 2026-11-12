# E04 – Self-service token dashboard

**Phase:** 1 · **Depends on:** E02 · **Business plan:** section 7 (Q1) · **Status:** open

## Goal
Customers see their consumed quota and manage their subscription themselves, without an account system: authentication is the token itself.

## Context / links
- Existing: `GET /v1/token`, `POST /v1/subscription/cancel`, renewal by `tokenId` checkout, buy page with stored token (`localStorage` `pdfcraft.paidToken`), [12](../12-paid-tokens-mollie.md).
- Quota usage comes from E02-05.

## Definition of done
- A customer can see plan, period, used/remaining quota, next payment and end date, and can cancel or renew, all in the app.
- Warnings appear before quota or term run out.

## Issues
- [ ] **E04-01 Usage data in the API** – Extend `GET /v1/token` (E02-05) with a short usage history (for example the last 12 months, counters kept in Valkey with a TTL) and a breakdown by endpoint group (invoice, document, bulk, postage). AC: documented; only counters, no document data.
- [ ] **E04-02 Dashboard page** – New route (for example `#/account`) with plan, quota bar, period, reset date, rate limit, bulk maximum and history chart; reachable from the nav when a token exists. AC: DE/EN, dark, narrow; works for free tokens (shows free limits).
- [ ] **E04-03 Subscription management** – Show subscription status and next payment date (stored with the subscription mapping or fetched from Mollie), cancel (exists), and links to renew and change plan (E03-04). AC: cancel flow tested with the mock; dates shown in the user's locale.
- [ ] **E04-04 Warnings** – Banner when ≥ 80 % of the quota is used, when the quota is exhausted (with reset date and upgrade link) and before expiry. AC: also shown in the editor, next to the download button; dismissible per period.
- [ ] **E04-05 Token handling** – Copy button, "show once" explanation, rotate token (new secret, old one invalid) for leaked tokens, and a ready-to-copy `curl` example using the token. AC: rotation endpoint is token-authenticated, rate limited and keeps plan/end date; tested with two instances.
- [ ] **E04-06 Named API keys per purchase (optional)** – Let API customers create several keys (for example production, staging) sharing one quota. AC: only if E00-04 decides it; otherwise mark the issue as dropped with the reason.
- [ ] **E04-07 Usage export** – Download usage history as CSV for API customers. AC: matches the displayed numbers.
- [ ] **E04-08 Tests and docs** – Frontend tests for the page states (free, paid, exhausted, expired), API tests for new fields; update `09`, `12`. AC: build green; screenshots reviewed.

## Open questions
- Should usage history be kept longer than 12 months (privacy: counters only)?
