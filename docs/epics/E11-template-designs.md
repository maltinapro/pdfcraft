# E11 – Additional template designs

**Phase:** 3 · **Depends on:** E00 (gating decision) · **Business plan:** section 7 (Q3–Q4) · **Status:** open

## Goal
Offer 3–4 selectable layouts (for example "Modern Minimal", "Klassisch Kanzlei", "Agentur Bold") next to the current default, for all document types, without losing e-invoice validity, DIN 5008 placement or render speed.

## Context / links
- `frontend/src/template/` (`invoice.typ`, `document-common.typ`, `offer.typ`, `order.typ`, `delivery-note.typ`, `credit-note.typ`, `letter.typ`), `backend/src/documents.rs` (templates via `include_str!`), design settings in `frontend/src/lib/types.ts` (`accentColor`, `font`, `footer`), DIN 5008 Form B (fold/punch marks, address field, reference line).
- Embedded fonts only (the Docker image installs system fonts too); font licenses must allow embedding and redistribution.

## Definition of done
- A `design` setting selects a layout for every document type; the API validates it; all designs render with and without watermark, with postage stamp and signature, and e-invoices stay valid. The render time budget holds.

## Issues
- [ ] **E11-01 Design concept** – Define what a design may change (typography, header/footer, table style, colors, spacing) and what is fixed (DIN 5008 address window, fold and punch marks, reference line, e-invoice-relevant content, postage placement). AC: written constraints; the default design is unchanged and stays the default.
- [ ] **E11-02 Template refactor** – Split shared Typst code into layout partials so a design replaces only styling functions; keep `invoice.typ` and `document-common.typ` aligned. AC: output of the default design is pixel-identical to before (rasterized comparison).
- [ ] **E11-03 Design "Modern Minimal"** – Light typography, generous whitespace, thin rules. AC: all document types, with/without watermark and signature, checked visually.
- [ ] **E11-04 Design "Klassisch Kanzlei"** – Serif typography, restrained table style, formal layout. AC: as above; letter and invoice reviewed on printed-size renders.
- [ ] **E11-05 Design "Agentur Bold"** – Strong accent color blocks, large headings. AC: as above; contrast and legibility checked in grayscale.
- [ ] **E11-06 Fonts** – Select and bundle fonts for the designs (embedded, license-checked, list in `docs/`), keep the existing font choice working. AC: no missing glyphs for German/EU characters; size impact on the image documented.
- [ ] **E11-07 Settings and API** – `settings.design` in `types.ts`, `invoice.rs` (allow-list), archive snapshots and backup/import (older files default to the standard design). AC: invalid ids give a translated `validation_error`; `settings.accentColor`/`font` interplay defined.
- [ ] **E11-08 Design picker UI** – Picker with thumbnails (pre-rendered PNGs or live preview) in the sender and design settings. AC: DE/EN, dark, narrow; changing the design updates the live preview.
- [ ] **E11-09 Tests and performance** – Extend `renders_every_document_type` to every design; rasterize and review pages; benchmark with `bench_render` (budget: no relevant regression of the < 10 ms claim). AC: PDF output reviewed visually, results in the PR.
- [ ] **E11-10 Gating, docs and news** – Apply the E00-05 decision (all free, or paid-only designs via the plan flag of E02). Update README, landing page and docs. AC: documented.

## Open questions
- Should the designs be customizable beyond accent color and font, or stay fixed products?
