# E01 – E-invoice conformance in CI

**Phase:** 1 · **Depends on:** – · **Status:** done

## Goal
The README and the landing page state that the embedded e-invoice XML is "validated with Mustang". Today that was checked by hand (see `AGENTS.md`, steps 4, 6, 30, 33); CI only runs `cargo check`, `cargo test` and `npm run build`. A change to `einvoice.rs`, `facturx.rs` or the templates can silently break validity. This epic makes the claim a CI guarantee.

## Context / links
- `backend/src/einvoice.rs` (XML), `backend/src/facturx.rs` (XMP), `backend/src/v1.rs` tests (`PDF_OUT=<dir>` writes the rendered PDFs), `.github/workflows/ci.yml`.
- Last manual result: Mustang 2.26.0, EN 16931 and XRechnung valid, PDF/A-3b.

## Definition of done
- Every PR that touches the backend renders a fixed corpus of e-invoices and fails if Mustang reports them invalid.

## Issues
- [x] **E01-01 Corpus** – A backend test renders a fixed set of invoices and credit notes into `PDF_OUT`: EN 16931 and XRechnung profile, several tax rates, a 0% item with exemption reason, a credit note (TypeCode 381). AC: files are written with stable names; the test also runs without `PDF_OUT`.
- [x] **E01-02 Mustang CI job** – New job in `ci.yml` downloads a pinned Mustang CLI (version and checksum fixed), validates the corpus and fails on any error. AC: job is green on `main`; breaking the XML on purpose turns it red; the jar is cached; runtime stays under a few minutes.
- [x] **E01-03 Docs** – Describe how to run the check locally in `docs/10-architecture-and-extending.md`. AC: wording of the "validated" claim in `README.md` matches what CI checks.

## Open questions
- (Decided: every PR, the job takes a few minutes.) Run on every PR or only when e-invoice related paths change? (Start with every PR; add a path filter if it is slow.)
