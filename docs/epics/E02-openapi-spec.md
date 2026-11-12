# E02 – OpenAPI specification

**Phase:** 1 · **Depends on:** – · **Status:** done

## Goal
The REST API is a selling point, but its description is a hand-written Markdown page ([09 API Reference](../09-api-reference.md)). A machine-readable OpenAPI spec lets developers generate clients and try requests, and keeps the reference from drifting.

## Context / links
- Endpoints in `backend/src/v1.rs`, `documents.rs`, `free.rs`, `mollie.rs`, `internetmarke.rs`; error codes in `frontend/src/lib/apiErrors.ts`.
- Not needed: hand-built SDKs (generators work from the spec), a Postman collection, a versioning policy beyond the existing `/v1` prefix.

## Definition of done
- `docs/openapi.yaml` describes the public `/v1` API, is linted in CI, and is the base of the published reference.

## Issues
- [x] **E02-01 Spec file** – Write OpenAPI 3.1 for `POST /v1/invoices`, `/v1/invoices/bulk`, `/v1/documents`, `/v1/documents/bulk`, `GET /v1/token`, auth (Bearer / `X-API-Key`), rate-limit headers, and the error envelope with its codes. Leave out purchase, Mollie webhook and postage endpoints for now. AC: request examples in the spec are the same JSON a backend test posts, so they stay valid; the spec is linted in CI.
- [x] **E02-02 Published reference** – Render the spec to a static page (no external requests, self-hosted assets) served with the frontend and linked from the landing page and `docs/09-api-reference.md`; add a short curl quickstart. AC: page in the sitemap; works offline from the built `dist/`.

## Open questions
- A scriptable test token is not available: the free token needs an Anubis browser cookie ([11](../11-free-token-and-anubis.md)), so REST users need a purchased token. Decide later whether that blocks developers; do not build a second token path before there is evidence.
