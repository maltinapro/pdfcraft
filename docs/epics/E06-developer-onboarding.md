# E06 – Developer onboarding and API docs

**Phase:** 1 · **Depends on:** E02 (quota headers) · **Business plan:** sections 2, 3 (target group 2), 5.3, 6.2 · **Status:** open

## Goal
"Integrate the `/v1` API in one hour": machine-readable spec, rendered reference, tested quickstarts and a way for developers to try it with a script, so API plans (Growth, Scale) can actually be sold.

## Context / links
- [09 API Reference](../09-api-reference.md), `backend/src/v1.rs`, `backend/src/invoice.rs`, `backend/src/documents.rs`, [11 Free token and Anubis](../11-free-token-and-anubis.md).
- The free token is only issued to browsers with a valid Anubis cookie, so scripts cannot obtain one.

## Definition of done
- OpenAPI spec published and checked in CI; quickstarts run in CI; developers can test with a watermarked token without a browser trick.

## Issues
- [ ] **E06-01 OpenAPI spec** – OpenAPI 3.1 for all `/v1` endpoints (requests, responses, error codes, auth, quota headers), generated or hand-written but verified against the handlers. AC: spec in the repo, linted in CI, served as a static file; request examples validate against `invoice.rs` rules.
- [ ] **E06-02 Rendered API reference** – Static reference page built from the spec with all assets self-hosted (no external requests), linked from the landing page and the docs. AC: DE/EN intro text; deep links per endpoint.
- [ ] **E06-03 Quickstarts** – curl, Node, Python, PHP and Rust examples (invoice, credit note, bulk ZIP, Factur-X attachment check) with sample JSON files. AC: examples run against a local backend in CI; the page states the one-hour path from token to first PDF.
- [ ] **E06-04 Developer test token** – Decide and implement how developers obtain a watermarked token without the Anubis browser flow (for example copy the free token from the app UI, or a dedicated rate-limited developer-token endpoint). AC: documented; abuse limits defined; no extra personal data.
- [ ] **E06-05 Error catalog** – Every error code with cause and fix, DE/EN, generated from the same list as `apiErrors.ts` where possible. AC: a test fails when a backend code has no entry.
- [ ] **E06-06 Versioning and changelog policy** – `/v1` stability promise, deprecation process, changelog page fed by GitHub releases (static, no runtime fetch). AC: policy in `09-api-reference.md`.
- [ ] **E06-07 API collection** – Postman/Bruno collection generated from the spec. AC: imports cleanly; contains the quota headers.
- [ ] **E06-08 Client SDKs (optional)** – Generated minimal clients (TypeScript, Python) from the spec. AC: only if the quickstarts show demand; otherwise dropped with a note.

## Open questions
- Is a hosted "try it" console in the reference page acceptable with the token only in browser memory?
