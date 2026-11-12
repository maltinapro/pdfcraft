# E08 – E-invoice viewer and checker

**Phase:** 2 · **Depends on:** E01 (validation corpus, E01-06) · **Business plan:** section 7 (Q2) · **Status:** open

## Goal
A free tool "Check and view ZUGFeRD / XRechnung": users drop a received e-invoice (PDF with embedded XML, or a plain XML file) and see it in readable form with a plausibility check. It is the main organic-traffic feature in the plan and a natural entry to the product.

## Context / links
- `backend/src/einvoice.rs` (XML generation, EN 16931 / XRechnung), `backend/src/facturx.rs` (lopdf XMP handling), `frontend/src/lib/validate.ts`.
- Privacy promise: no customer data is retained; the preferred design keeps the file in the browser.

## Definition of done
- UBL and CII invoices (including Factur-X/ZUGFeRD PDFs and XRechnung) are displayed readably with errors and warnings explained in DE/EN; the tool is findable by search; no file is stored.

## Issues
- [ ] **E08-01 Spike: where does it run** – Compare in-browser (WASM/pdf.js, XML parsing in JS) with a stateless backend endpoint for extraction, parsing and validation (effort, bundle size, rule coverage, privacy, abuse). AC: decision with measurements in `decisions.md`; default is "file never leaves the browser" unless a rule cannot be implemented there.
- [ ] **E08-02 Extract embedded XML** – Accept PDFs and find the attachment (`factur-x.xml`, `zugferd-invoice.xml`, `xrechnung.xml`, `ZUGFeRD-invoice.xml`) and plain `.xml`. AC: handles PDF/A-3 with several attachments; clear message when no XML exists; size limit.
- [ ] **E08-03 Parse CII and UBL** – Map both syntaxes to one view model (parties, references, items, tax breakdown, totals, payment means, notes, attachments). AC: test corpus of valid files (own output plus public samples with compatible licenses), including credit notes (381) and several tax rates.
- [ ] **E08-04 Readable view** – Page `#/viewer` rendering the view model like an invoice (human-readable, printable), with a raw XML tab. AC: DE/EN, dark, narrow; handles missing optional fields.
- [ ] **E08-05 Validation** – Schema plus the business rules that can be implemented reliably (EN 16931 BR-*, XRechnung BR-DE-*), profile detection (Factur-X profiles, XRechnung CIUS), each finding with a plain-language explanation and a hint what to fix. AC: results match Mustang/KoSIT on the corpus; unsupported rules are listed so the tool never claims "valid" beyond what it checked.
- [ ] **E08-06 PDF-level checks** – PDF/A-3 identification, Factur-X XMP (`fx:` metadata), attachment relationship. AC: reuses knowledge from `facturx.rs`; findings marked as notices where no hard rule exists.
- [ ] **E08-07 Backend endpoint (only if E08-01 requires it)** – `POST /v1/einvoice/check`, stateless, request-size limit, free-token/Anubis protected, rate limited, counted per E00-03. AC: nothing logged from the file; metric and error translations added.
- [ ] **E08-08 Handoff to the product** – From a received invoice: "Create a credit note" prefill (reuses `FOLLOW_UPS` ideas) and "Save sender as recipient" (E07). AC: optional; only if the view model maps cleanly.
- [ ] **E08-09 Landing page and SEO** – Static page "ZUGFeRD / XRechnung prüfen & anzeigen" (E05 template) with sample files, FAQ and a link into the tool. AC: in the sitemap; claims limited to what the tool checks.
- [ ] **E08-10 Docs and news** – README, docs, "Neuigkeiten". AC: privacy policy states that the file is processed locally (or, if E08-07 exists, transiently).

## Open questions
- Is a full KoSIT-equivalent validation in scope, or a documented subset with a link to the official validator?
