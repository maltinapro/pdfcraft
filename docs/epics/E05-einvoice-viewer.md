# E05 – E-invoice viewer and checker

**Phase:** 2 · **Depends on:** E01 (test corpus), E03-01 (page scaffold) · **Status:** open

## Goal
A free tool "ZUGFeRD / XRechnung anzeigen und prüfen": drop a received e-invoice (PDF with embedded XML, or a plain XML) and read it as a normal invoice. Everyone has to receive e-invoices now, so this attracts traffic and leads into the product. The file never leaves the browser.

## Context / links
- Generation side: `backend/src/einvoice.rs`, `facturx.rs`; form checks: `frontend/src/lib/validate.ts` (these check the form, not XML).
- Browser-only by design: no new endpoint, nothing to rate limit, nothing to retain. A server-side validator (KoSIT equivalent) is out of scope; the page links to the official validator for a full check.

## Definition of done
- UBL and CII invoices (Factur-X/ZUGFeRD PDFs and XRechnung XML) are shown readably, with a clearly limited plausibility check; no file is uploaded.

## Issues
- [ ] **E05-01 Extract the XML** – Read a dropped PDF in the browser and find the attachment (`factur-x.xml`, `zugferd-invoice.xml`, `ZUGFeRD-invoice.xml`, `xrechnung.xml`); accept plain `.xml`. AC: PDF library loaded lazily (own chunk, not in the main bundle); size limit; clear message when no XML exists.
- [ ] **E05-02 Parse CII and UBL** – Map both syntaxes to one view model (parties, references, items, tax breakdown, totals, payment means, notes). AC: tests with the E01 corpus plus public samples with compatible licenses, including credit notes and several tax rates.
- [ ] **E05-03 View page** – Public route `#/viewer` (works without a token) showing the invoice readably and printable, plus a raw XML tab. AC: DE/EN, dark, narrow; missing optional fields do not break the view.
- [ ] **E05-04 Plausibility check** – Recompute line, tax and total sums and check mandatory fields; show findings in plain language and list exactly what was checked. AC: the page never says "valid"; it says what was checked and links to the official validator.
- [ ] **E05-05 Landing page and docs** – Static page "ZUGFeRD / XRechnung prüfen" (E03 scaffold) with a short FAQ, sitemap entry, privacy policy line ("processed locally"), README, "Neuigkeiten". AC: claims limited to what E05-04 checks.

## Open questions
- Which PDF library is smallest for attachment extraction only (`pdf-lib` vs. `pdfjs-dist`)? Decide in E05-01 by bundle size.
