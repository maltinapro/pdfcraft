# E11 – Distinct PDF designs

**Phase:** 4 · **Depends on:** – (E08-03 relies on its zone invariants) · **Status:** open

## Goal
Make the PDF designs clearly different. Today *Classic* and *Modern Minimal* differ only in title size/color, one rule and zebra rows, and the picker thumbnails look identical. Each design gets its own character while DIN 5008 placement, the e-invoice and performance stay intact.

## Context / links
- [Design guide](../16-design-guide.md) section 10 (binding: invariants, design axes, picker).
- Builds on [E06](E06-template-designs.md): `settings.design` allow-list in `backend/src/invoice.rs`, templates `frontend/src/template/invoice.typ` and `document-common.typ` (duplicated header, address field, table and totals), `backend/src/documents.rs` (`include_str!`, prepends `document-common.typ`), `DESIGNS` in `frontend/src/lib/types.ts`, thumbnails in `frontend/public/design-previews/`.
- Tests: `renders_invoice_with_and_without_watermark`, `renders_every_document_type`, `renders_einvoice_conformance_corpus` (Mustang in CI), benchmark `bench_render`.

## Definition of done
- Three designs (*Classic*, redefined *Modern Minimal*, new *Contrast*) for all six document types, recognizably different in the picker; DIN positions unchanged, e-invoice corpus valid in every design, render times within the E06 range.

## Issues
- [ ] **E11-01 Shared layout module** – Move header, address field, meta block, item table, totals, payment block and footer into one shared Typst module used by the invoice and the five other types, driven by a design token dictionary; designs only provide tokens and optional header/totals variants. AC: Classic output unchanged (rasterized pages compared before/after); no duplicated layout code between `invoice.typ` and `document-common.typ`.
- [ ] **E11-02 Modern Minimal redefined** – Implement the "Modern Minimal" column of the guide (sender line under a small logo, DIN information block right of the address field, muted type label above a large number, hairline table, large "Amount due", left-aligned footer). AC: all six types with and without watermark, with signature and postage; existing configs and archive snapshots with `modern-minimal` render with the new look.
- [ ] **E11-03 Contrast design** – New allow-listed value (working title `contrast`, final name decided in the PR) per the guide: accent header band, accent table header, accent totals box; on-accent text switches to dark when the accent is too light. AC: readable with the lightest and darkest accent colors; fold/punch marks and the address field untouched by the band.
- [ ] **E11-04 Picker, tests and docs** – Regenerate thumbnails from real renders for all designs, add a one-line description per design to the picker, run the e-invoice corpus and `renders_every_document_type` for every design, extend `bench_render`, update README, `docs/10`, "Neuigkeiten", `AGENTS.md` and the OpenAPI enum. AC: Mustang valid for every design; benchmark table added here.

## Open questions
- Optional structured footer (contact / bank / tax columns built from the sender data) as a design element? Only if users ask; it would change documents that have an empty footer today.
