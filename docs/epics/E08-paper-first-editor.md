# E08 – Paper-first editor

**Phase:** 4 · **Depends on:** E07-01 to E07-04 · **Status:** open

## Goal
Replace the two tabs ("Invoice" / "Sender & design") and the long form with the zone concept: four color-coded zones, a guided first run, returning users start where something is missing, and the real PDF preview becomes a way to navigate ("the paper is the form").

## Context / links
- [Design guide](../16-design-guide.md) section 2 (binding), section 9 (what to take from the owner's M3 demo).
- Today: `Workspace.tsx` (tabs, issue summary, `jumpTo`, preview double buffering, mobile Form/Preview switch), `InvoiceForm.tsx`, `DocumentForm.tsx`, `SettingsForm.tsx`, `ItemsEditor.tsx`, `MasterDataPickers.tsx`, `PostageSection.tsx`, `PdfCanvasPreview.tsx`, `lib/documents.ts` (`DOC_SPECS`), `lib/validate.ts`.
- Zone geometry for zones 3 and 4 needs the backend (Typst label positions); no customer data is returned or stored.

## Definition of done
- All six document types are edited through zones on desktop and mobile; the five-task protocol shows fewer taps and less time than the E07-05 baseline; no feature of the old editor is lost (drafts, master data pickers, postage, signature, issue jumps, download, archive entry).

## Issues
- [ ] **E08-01 Zone model** – `ZONES` next to `DOC_SPECS`: which fields belong to which zone for each document type (letter: Text instead of Items; delivery note: items without prices) and a zone state (untouched, complete, warnings, errors) derived from the existing issues. AC: Vitest tests for every type; every form field key is in exactly one zone.
- [ ] **E08-02 Zone bar and panels** – Zone bar, zone header cards, one panel per zone, sticky footer with Back / Next / Create PDF and the save status; zone 1 ("Sender & look", applies to all documents) collapses to a summary chip when complete; the editor opens at the first incomplete zone; `jumpTo` and the issue summary work across zones; saved-recipient and article pickers become tonal buttons. AC: first run starts at zone 1, a returning user at zone 2 with the recipient picker focused; DE/EN, light/dark, 390/1440 px screenshots.
- [ ] **E08-03 Preview with zone overlay** – pdf.js canvas preview for all browsers (zoom with "fit page" and "fit width", pages, "Open PDF"), zone areas as tints, click/tap opens the zone; zones 1–2 from fixed DIN positions, zones 3–4 from positions the backend reports (Typst labels queried after compile, small JSON response header, documented in `docs/09` and the OpenAPI overlay if it is part of `/v1`). AC: overlay matches the PDF in every design and for multi-page documents; desktop opens with the whole page visible; preview update time not worse than today; fallback without the header.
- [ ] **E08-04 Mobile editor** – Below 840 px: editor bar (zone chips + Back/Next) replaces the bottom navigation, Fields | Sheet segmented button, in Sheet mode a zone tap opens a bottom sheet with that zone's fields; swipe only on zone bar and sheet handle. AC: 320/390 px screenshots; on-screen keyboard does not cover the focused field; chrome ≤ 120 px while editing.
- [ ] **E08-05 Items zone** – Item cards with live line totals, reorder (drag handle + up/down), remove, *Add item*, *From articles*, *Save as article*, totals card with VAT per rate; works for delivery notes (no prices) and credit notes; the sticky footer never covers the add buttons. AC: existing `ItemsEditor` behavior and tests preserved; 60 items stay responsive.
- [ ] **E08-06 Finish and success state** – Create PDF as the last zone's primary action; when blocked, the button explains why and jumps to the first issue instead of being disabled; "Show e-invoice XML" reads the attachment from the rendered PDF (E05 extractor); after download a success panel offers backup, new document and follow-up documents. AC: no disabled primary button without an explanation; network errors are translated.
- [ ] **E08-07 Usability check and docs** – Repeat the five-task protocol, compare with E07-05, record results here; update README, `docs/10`, "Neuigkeiten", `AGENTS.md`. AC: results table committed; regressions fixed or listed as follow-ups.
- [ ] **E08-08 Service date and due date** – Optional service date or period (from/to) in zone 3, default = invoice date; the due date is shown as a date (computed from payment days, editable as a date). Follows the "new form field" path in `AGENTS.md` (`types.ts`, `invoice.rs` validation, `einvoice.rs`: `ActualDeliverySupplyChainEvent` or `BillingSpecifiedPeriod`, due date), templates print both, `apiErrors.ts` field labels, OpenAPI regenerated, e-invoice corpus case added. AC: Mustang valid for both profiles; old configs and archive snapshots without the fields render as today.

## Open questions
- Zone 3/4 geometry: response header on `/v1/invoices` and `/v1/documents`, or only for preview requests (query flag)? Decide in E08-03; keep API consumers unaffected by default.
