# E06 – Additional template design

**Phase:** 3 (start only after E01–E05, and when users ask for it) · **Depends on:** – · **Status:** done (implemented at user request while E03 remains in progress)

## Goal
Today there is one layout; users can change accent color, font and footer. Add a selectable design setting and prove it with **one** more design. Every design must be kept in sync for six document types, DIN 5008 placement and the e-invoice must stay intact, so more designs are added only after this one has been used.

## Context / links
- Templates in `frontend/src/template/` (`invoice.typ`, `document-common.typ` for the other five types), `backend/src/documents.rs` (`include_str!`), `backend/src/invoice.rs` (validates settings), `frontend/src/lib/types.ts`, `SettingsForm.tsx`.
- Tests `renders_invoice_with_and_without_watermark` and `renders_every_document_type` (`PDF_OUT=<dir>`).
- Not planned: plan gating (there is no plan model, see the roadmap), custom per-customer templates.

## Definition of done
- Users pick between the current and one new design for all six document types; PDFs stay DIN 5008 compliant in placement, e-invoice valid (E01) and fast.

## Issues
- [x] **E06-01 Design setting** – `settings.design` is allow-listed (`classic` / `modern-minimal`) and defaults to Classic. Existing configs load with Classic; archive snapshots retain their issue-time design. GitHub: [#153](https://github.com/maltinapro/pdfcraft/issues/153).
- [x] **E06-02 Second design** – Modern Minimal styles all six documents through the shared templates. Both designs render with and without watermarks; invoice previews use the real logo; the e-invoice corpus renders in both designs. DIN 5008 page marks, address field and reference line are unchanged. GitHub: [#154](https://github.com/maltinapro/pdfcraft/issues/154).
- [x] **E06-03 Picker** – Bilingual settings picker with static PNG previews rendered from the real invoice templates. Selection updates the existing live preview and is stored in config/backup/archive. GitHub: [#151](https://github.com/maltinapro/pdfcraft/issues/151).
- [x] **E06-04 Performance and docs** – Added separate Classic/Modern Minimal timings for 3- and 60-item invoices to `bench_render`; results are below. Updated README, `docs/10`, "Neuigkeiten" and this epic. GitHub: [#152](https://github.com/maltinapro/pdfcraft/issues/152).

## Performance results

Measured with `cd backend && PDF_OUT=/tmp/pdfcraft-designs cargo test --release bench_render -- --ignored --nocapture`. Each render median is based on 24 measured iterations after a warm-up render; PDF size is from the same run.

| Design | 3 items (median / PDF size) | 60 items (median / PDF size) | 20 × 3 items (sequential / parallel) | 20 × 60 items (sequential / parallel) |
| --- | ---: | ---: | ---: | ---: |
| Classic | 5.1 ms / 55,890 B | 25.8 ms / 131,552 B | 104 / 50 ms | 528 / 297 ms |
| Modern Minimal | 5.9 ms / 55,698 B | 26.3 ms / 119,693 B | 120 / 56 ms | 542 / 302 ms |

These release-build measurements are machine-dependent. The largest observed median difference was 0.8 ms for a 3-item invoice and 0.5 ms for 60 items; the new design also produced smaller PDFs, with no meaningful performance regression in this run.
