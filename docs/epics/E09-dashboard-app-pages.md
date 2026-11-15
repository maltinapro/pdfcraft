# E09 – Dashboard and app pages

**Phase:** 4 · **Depends on:** E07 · **Status:** open

## Goal
Bring the start page and every other app page onto the new shell and components, with less scrolling and clearer priorities: creating an invoice is one tap from Start.

## Context / links
- [Design guide](../16-design-guide.md) sections 5–7, 11 (findings 4, 7).
- Today: `Dashboard.tsx` (welcome card, seven equal tiles, recent documents), `DocumentsPage.tsx`, `ArchiveList.tsx`, `MasterDataPage.tsx`, `DataPage.tsx`, `BackupBanner.tsx`, `BuyPage.tsx`, `ViewerPage.tsx`, `FreeVersionHint.tsx`.

## Definition of done
- All app pages use the E07 shell and components; on a 390 px screen the start page shows the invoice action and the other document types without scrolling past the first screen.

## Issues
- [ ] **E09-01 Start page** – *Invoice* as a large primary card, the five other types as a compact grid (2 columns on compact), "Getting started" as a checklist (company details, first document, first backup) that disappears when done, three recent documents, small link card to the e-invoice viewer. AC: all document types visible within the first 844 px at 390 px width; DE/EN, light/dark.
- [ ] **E09-02 Belege** – Archive as an M3 list with filter chips (type, period, cancelled), search, row overflow menu (follow-up, cancel, download again), bulk ZIP as a contextual action. AC: existing archive features and GoBD notice kept.
- [ ] **E09-03 Kunden, Data & backup, Buy, Viewer** – Apply the components; *Kunden* holds customers and articles as two tabs; *Mehr* lists viewer, data & backup, buy token, language, theme, legal links. AC: screenshots per page in DE/EN, light/dark, 390/1440 px; buy flow consent checkboxes unchanged.
- [ ] **E09-04 Empty, loading and error states** – One pattern for empty lists, loading and errors (icon, sentence, action); raw messages such as "Failed to fetch" are translated via `apiErrors.ts`. AC: every page has a designed empty state; no untranslated error text reaches the UI.
