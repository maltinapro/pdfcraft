# E06 – Additional template design

**Phase:** 3 (start only after E01–E05, and when users ask for it) · **Depends on:** – · **Status:** open

## Goal
Today there is one layout; users can change accent color, font and footer. Add a selectable design setting and prove it with **one** more design. Every design must be kept in sync for six document types, DIN 5008 placement and the e-invoice must stay intact, so more designs are added only after this one has been used.

## Context / links
- Templates in `frontend/src/template/` (`invoice.typ`, `document-common.typ` for the other five types), `backend/src/documents.rs` (`include_str!`), `backend/src/invoice.rs` (validates settings), `frontend/src/lib/types.ts`, `SettingsForm.tsx`.
- Tests `renders_invoice_with_and_without_watermark` and `renders_every_document_type` (`PDF_OUT=<dir>`).
- Not planned: plan gating (there is no plan model, see the roadmap), custom per-customer templates.

## Definition of done
- Users pick between the current and one new design for all six document types; PDFs stay DIN 5008 compliant in placement, e-invoice valid (E01) and fast.

## Issues
- [ ] **E06-01 Design setting** – `settings.design` (enum, default = current look) in `types.ts`, `invoice.rs` (validated), storage, backup and archive snapshots; the templates read it as a parameter instead of separate files. AC: existing configs and archives load unchanged; the default design renders as before.
- [ ] **E06-02 Second design** – One new design ("Modern Minimal") for all six document types. AC: fold/punch marks, address field and reference line unchanged; `renders_every_document_type` renders it; PDFs rasterized and looked at (with/without watermark, with logo, 60 items).
- [ ] **E06-03 Picker** – Design choice in the settings form with static preview images made from real renders. AC: DE/EN, dark, narrow; the live preview updates.
- [ ] **E06-04 Performance and docs** – Benchmark (`cargo test --release bench_render -- --ignored --nocapture`) shows no meaningful regression; README, `docs/10`, "Neuigkeiten". AC: numbers in the PR.
