# Design Guide

The binding reference for the look and behavior of the PDFCraft frontend (configurator, dashboard, landing pages) and of the generated PDF designs. Every UI or PDF design change refers to this guide; a change that deviates from it updates the guide in the same PR.

**Status:** target design, written in November 2026 from a usability review of the current app (see [Usability review](#11-usability-review-november-2026)) and the owner's Material Design 3 concept and demo (wizard with color-coded steps). It is implemented step by step in phase 4 of the [roadmap](roadmap.md) (epics [E07](epics/E07-design-system-app-shell.md)–[E11](epics/E11-distinct-pdf-designs.md)). Until an epic is done, the code may still show the old design.

Contents: [1 Principles](#1-principles) · [2 Core concept](#2-core-concept-the-paper-is-the-form) · [3 App shell and navigation](#3-app-shell-and-navigation) · [4 Foundations](#4-foundations) · [5 Components](#5-components) · [6 Pages](#6-pages) · [7 Content and language](#7-content-and-language) · [8 Accessibility](#8-accessibility) · [9 The M3 demo: adopt, adapt, reject](#9-the-m3-demo-adopt-adapt-reject) · [10 PDF designs](#10-pdf-designs) · [11 Usability review](#11-usability-review-november-2026) · [12 Implementation rules](#12-implementation-rules)

---

## 1. Principles

1. **One thing at a time.** A screen asks for one part of the document (a *zone*). Everything else is collapsed into a one-line summary.
2. **The paper is the interface.** The real PDF preview is not a side panel but a way to navigate: every area of the sheet opens the fields that fill it.
3. **Returning users go straight to work.** Data entered once (sender, bank, design) is never in the way again; the editor starts where something is still missing.
4. **Calm surfaces, no boxes in boxes.** Depth comes from tonal surfaces (Material Design 3), not from borders. At most one surface level inside a panel.
5. **Local-first trust is visible.** "Saved in this browser" and the backup reminder stay quietly present; nothing suggests a cloud account.
6. **Honest compliance.** Only claim what the code verifies (EN 16931 / XRechnung XML validated in CI, DIN 5008 placement). No version or certificate claims beyond that.
7. **Accessible by default.** WCAG 2.2 AA contrast, 48 px touch targets, color is never the only signal.

## 2. Core concept: "the paper is the form"

The editor combines a guided first run with a paper-first editing model. It is the same UI for all six document types; only the zones differ.

### 2.1 Zones

A document is divided into four **zones**. Each zone has a number, an icon, a color and a fixed area on the A4 sheet. The area is design-invariant because every PDF design keeps the DIN 5008 positions (see [10.1](#101-invariants-all-designs)).

| # | Zone | Fields (invoice) | Area on the sheet | Color (light / dark) |
| --- | --- | --- | --- | --- |
| 1 | **Sender & look** (`sender`) | company, address, contact, tax numbers, bank, logo, signature, design, accent color, font, texts, e-invoice profile | header (0–45 mm), payment block, footer | violet `#4A2FB0` / `#D0BCFF` |
| 2 | **Recipient** (`recipient`) | name, address, e-mail, VAT ID, buyer reference, saved recipients, postage | address field (45–92.4 mm) | coral `#C9411E` / `#FFB5A0` |
| 3 | **Details** (`details`) | number, date / period, due date, references, subject, intro | reference line, title row | amber `#8D4E00` / `#FFB870` |
| 4 | **Items** (`items`) | line items, articles, totals, closing text | table, totals, closing | green `#146C2E` / `#85D696` |

Per document type: the letter has **Text** (subject, body) instead of Items; the delivery note shows items without prices; credit notes add the reference to the invoice in Details. The mapping lives in one place (`ZONES` next to `DOC_SPECS` in `frontend/src/lib/documents.ts`) and is unit-tested.

Zone 1 holds settings that apply to **all** documents. Its panel says so ("Applies to all documents") and shows the same data for every type.

### 2.2 Flow

- **First run** (sender still has the example data): the editor starts at zone 1 and guides linearly: *Back* / *Next: Recipient* in a sticky footer.
- **Returning user** (zone 1 complete): zone 1 shows as a summary chip ("Muster GmbH · DE89 … 3000 · Classic ✓") and the editor opens at the **first incomplete zone**, normally *Recipient* with the saved-recipient picker focused.
- Zones can be visited in any order: zone bar, preview tap, issue list. "Next" is a suggestion, not a gate.
- Each zone in the zone bar shows its state: number (untouched), check (complete), count badge (errors), "!" (warnings only). The state comes from the existing issue model (`requiredIssues`, `validateInvoice`, backend `ValidationError`, see `Workspace.tsx`).
- The last zone's footer button is the primary action: **Create PDF**. After the download a success panel offers the next steps (back up, new document, follow-up document) instead of a dismissible notice.

### 2.3 Preview with zone overlay

- The preview renders the **real PDF** from the backend with pdf.js (`PdfCanvasPreview`, already a lazy chunk) for all browsers, so the overlay can be positioned exactly; the native iframe viewer is replaced. The toolbar offers zoom, page navigation, "Open PDF" and "Show e-invoice XML" (read from the rendered PDF with the E05 extractor, read-only).
- Zone areas are drawn as a light tint (`previewTint`, 6 % of the zone color) on hover/focus and permanently for the active zone. Clicking an area opens that zone and focuses its first field.
- Zone geometry: zones 1 and 2 are fixed by DIN 5008. Zones 3 and 4 depend on content; the backend reports them (Typst labels queried after compiling, returned as a small JSON header, no customer data). Fallback when the header is missing: fixed DIN areas only.
- Double buffering, debouncing and "preview paused while blocking errors exist" stay as they are.

### 2.4 Layout per window size

Window classes follow Material 3: **compact** < 600 px, **medium** 600–839 px, **expanded** ≥ 840 px (replaces today's 800 px breakpoint).

- **Expanded:** split screen. Left: zone bar, zone panel (520–600 px), sticky footer. Right: preview on `surface-container-high`.
- **Compact / medium:** the editor is a focused task: the global bottom navigation is hidden and replaced by an **editor bar** at the bottom (zone chips + Back/Next/Create). A segmented button in the top bar switches **Fields | Sheet**. In *Sheet* mode, tapping a zone opens a **bottom sheet** (up to 85 % height) with that zone's fields, so the user never loses sight of the document.
- Swipe between zones is allowed only on the zone bar and the sheet handle, never across the form body (conflicts with text selection, horizontal input scrolling and the iOS back gesture).

## 3. App shell and navigation

### 3.1 Top app bar

- Height 64 px (expanded) / 56 px (compact), `surface-container` background, no gradient, no border.
- Left: back/navigation icon (inside the editor), logo mark, page title (one line, ellipsis). Right: at most **one** primary action (filled button; icon-only on compact) plus an overflow menu (⋮) holding language, theme, version and help.
- Nothing in the top bar wraps. Verified at 320, 390, 768 and 1440 px.

### 3.2 Global navigation

Top-level destinations get **one-word labels** (≤ 10 characters) and an icon:

| Destination | DE | EN | Contains |
| --- | --- | --- | --- |
| Start | Start | Home | create tiles, recent documents, getting started |
| Documents | Belege | Documents | archive, bulk ZIP, cancel, follow-ups |
| Contacts | Kunden | Customers | customers and articles (two tabs inside) |
| More | Mehr | More | view e-invoice, data & backup, buy token, language, theme, legal |

- **Compact / medium:** M3 **navigation bar** at the bottom (80 px, icon + label, active indicator pill). Replaces the header links that wrap today.
- **Expanded:** the same four destinations as a **navigation rail** (left, 80 px) or as tabs in the top bar; the choice is made once in E07-04 and applied everywhere.
- The backup reminder is a badge on *Mehr* (dot) and on *Data & backup* inside it.

## 4. Foundations

### 4.1 Color roles

Defined once as CSS custom properties (`frontend/src/styles/tokens.css`), light and dark (`[data-theme="dark"]` and `prefers-color-scheme`). Components only use roles, never hex values.

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-primary` | `#4A2FB0` | `#D0BCFF` | brand actions, focus, links |
| `--color-on-primary` | `#FFFFFF` | `#381E72` | text/icons on primary |
| `--color-primary-container` | `#EADDFF` | `#4F378B` | tonal buttons, selected states |
| `--color-on-primary-container` | `#21005D` | `#EADDFF` | text on primary container |
| `--color-surface` | `#FEF7FF` | `#141218` | page background |
| `--color-surface-container-low` | `#F7F2FA` | `#1D1B20` | editor panel |
| `--color-surface-container` | `#F3EDF7` | `#211F26` | top bar, cards, footer bars |
| `--color-surface-container-high` | `#ECE6F0` | `#2B2930` | preview canvas, dialogs |
| `--color-surface-container-highest` | `#E6E0E9` | `#36343B` | filled text fields |
| `--color-on-surface` | `#1D1B20` | `#E6E0E9` | text |
| `--color-on-surface-variant` | `#49454F` | `#CAC4D0` | labels, supporting text |
| `--color-outline` | `#79747E` | `#938F99` | field indicator at rest |
| `--color-error` / `--color-error-container` | `#B3261E` / `#F9DEDC` | `#F2B8B5` / `#8C1D18` | errors |
| `--color-warning` / `--color-warning-container` | `#8D4E00` / `#FFF8E1` | `#FFB870` / `#3E2D00` | warnings, example data |
| `--color-success` | `#146C2E` | `#85D696` | saved, complete |

Zone colors (`--zone-<id>`, `--zone-<id>-container`, `--zone-<id>-on-container`, `--zone-<id>-tint`) take the values of the owner's demo:

| Zone | primary L / D | container L / D | on-container L / D |
| --- | --- | --- | --- |
| sender | `#4A2FB0` / `#D0BCFF` | `#EADDFF` / `#381E72` | `#21005D` / `#EADDFF` |
| recipient | `#C9411E` / `#FFB5A0` | `#FFDBD1` / `#72230B` | `#3B0900` / `#FFDBD1` |
| details | `#8D4E00` / `#FFB870` | `#FFDCC2` / `#693C00` | `#2E1500` / `#FFDCC2` |
| items | `#146C2E` / `#85D696` | `#C4EED0` / `#0F5223` | `#072711` / `#C4EED0` |

Contrast (checked): all four light primaries reach ≥ 4.9:1 on white and on `surface`; all dark primaries ≥ 10:1 on `#141218`. The concept's lighter tones `#F25D39` (3.3:1) and `#16A34A` (3.3:1) **fail AA** for text and white-on-color buttons; they stay decorative only (logo, illustrations).

Rules:
- Zone colors appear only inside the editor; document-type colors (`DOC_SPECS[].color`) only on the dashboard and archive badges. Never both in one component.
- Brand navy `#241259` and orange `#F25D39` belong to the logo and the landing hero, not to app controls.
- The PDF accent color (`settings.accentColor`) is document content and never tints app UI.

### 4.2 Typography

Inter Variable, self-hosted (`@fontsource-variable/inter`, no external requests). Numbers in tables and totals use `font-variant-numeric: tabular-nums` (no monospace font).

| Token | Size / line | Weight | Use |
| --- | --- | --- | --- |
| `display` | 40/48 (landing 48–56) | 650 | landing hero only |
| `headline` | 24/32 | 500 | page titles, zone headers |
| `title-l` | 20/28 | 600 | dialog titles, dashboard sections |
| `title-m` | 16/24 | 600 | card titles, field group titles |
| `body-l` | 16/24 | 400 | inputs (16 px avoids iOS zoom), body text |
| `body-m` | 14/20 | 400 | secondary text |
| `label-l` | 14/20 | 500 | buttons, tabs |
| `label-m` | 12/16 | 500 | floating labels, chips, supporting text |

Sentence case everywhere; no ALL-CAPS section titles.

### 4.3 Spacing, shape, elevation, motion

- **Spacing:** 4 px grid; steps 4, 8, 12, 16, 20, 24, 32, 48. Fields in a group: 20 px apart; groups: 32 px; panel padding 24 px (compact 16 px).
- **Shape:** `--radius-xs` 4 · `-s` 8 · `-m` 12 (field top corners, chips) · `-l` 16 (cards) · `-xl` 28 (dialogs, bottom sheets) · `-full` (buttons, segmented buttons, nav indicator).
- **Elevation:** tonal (surface-container levels). Shadows only for floating elements (menus, snackbar, bottom sheet, the A4 sheet).
- **Motion:** 150 ms state changes, 250 ms panels, 400 ms zone change, easing `cubic-bezier(0.2, 0, 0, 1)`. `prefers-reduced-motion: reduce` → no translate/scale, only opacity ≤ 100 ms.

### 4.4 Icons

One outline icon set (24 px grid, 1.75 px stroke, round caps), Lucide-style shapes kept as inline SVG in `components/icons.tsx` (no icon font, no CDN). Emoji are not used as icons (`⬇`, `🌙`, `✓`, `⚠` are replaced). Icons accompany labels; icon-only buttons need `aria-label` and a tooltip.

## 5. Components

All components live in `frontend/src/components/ui/` and only use tokens. Existing behavior is preserved: the `field` keys, `data-field`, touched/revealed issue logic (`Field.tsx`, `FormIssues.tsx`) and `tr()` texts.

- **Filled text field** (default input): 56 px high, `surface-container-highest`, top corners `radius-m`, no outline; bottom indicator 1 px `outline` → 2 px zone color on focus. Floating label (`label-m`) inside the field; supporting text below (12/16). Optional fields say "optional" in the label (`Leitweg-ID (optional)`) instead of marking required ones with `*`. States: error (indicator, label and supporting text in `error`, icon at the end), warning (example data, `warning`), disabled (38 % opacity). Suffixes (€, %, unit) inside the field.
- **Filled select:** same frame plus a chevron; native `<select>` for accessibility and mobile pickers.
- **Textarea:** same frame, grows with content up to 8 lines.
- **Buttons:** *filled* (one primary per view, zone color inside the editor, `primary` elsewhere), *tonal* (secondary: Back, Add item, Choose saved recipient), *text* (tertiary), *icon* (40 px visual, 48 px hit area), *danger tonal* (remove). Height 40 px, `radius-full`, `label-l`.
- **Segmented button:** language, Fields/Sheet, design variants; check icon in the selected segment.
- **Chips:** *assist* (zone summary "Muster GmbH ✓ Change"), *filter* (archive), *status* (open issues count in the top bar; tap = jump to the first issue).
- **Zone bar:** horizontal, 28 px number circles, 2 px connectors; label visible for the active zone (compact) or all zones (expanded); roving tabindex, arrow keys only while the bar has focus.
- **Zone header:** tonal card in the zone container color: "02 · Recipient", title, one-sentence purpose, zone icon.
- **Item card** (zone 4): card on `surface-container` with position number, live net line total, reorder (drag handle + up/down), remove; fields description, quantity + unit, unit price + VAT rate. Below the list: *Add item* (tonal, full width), *From articles* (tonal), and a totals card (net, VAT per rate, gross in `headline`).
- **Banner** (inline, top of a panel): issues and example-data hints; each entry is a link that jumps to the field. No "fill with demo data" action.
- **Bottom sheet, dialog, menu, snackbar:** M3 standard; snackbar for transient confirmations ("Recipient saved"), never for errors that need action.
- **Empty and error states:** an icon, one sentence what happened, one action. Network errors are translated ("No connection to the PDF service – we will retry automatically") instead of raw messages such as "Failed to fetch".

## 6. Pages

- **Start (dashboard):** "What would you like to create?" with *Invoice* as a large primary card and the five other types as a compact grid (2 columns on compact, short labels, one-line description on expanded only). "Getting started" is a checklist (company details · first document · first backup) that disappears when done. Recent documents below (3 entries, link to *Belege*). The e-invoice viewer moves to *Mehr* and keeps a small link card on Start.
- **Belege, Kunden, Data & backup, Buy, Viewer:** same shell, lists as M3 list items with an overflow menu for row actions, filter chips, search field in the top bar on compact.
- **Landing and static pages** (`index.html`, SEO pages, legal pages, `/api/`): same tokens and type scale; landing header collapses to logo + "Open app" + menu on compact. The hero may show the zone concept (animated A4 sheet, CSS/SVG only, no JS framework, respects reduced motion). Pages stay static, fast (Lighthouse performance and accessibility ≥ 95) and without external requests.

## 7. Content and language

- All UI text via `tr(de, en)`; German first. Short, active, no jargon in labels; jargon (Leitweg-ID, EN 16931) is explained in supporting text.
- Navigation labels one word; button labels verb first ("Create PDF", "Save recipient").
- Numbers and dates formatted by locale; currency with non-breaking space.
- No fake data generators. Example data is marked as such and the user is led to replace it.

## 8. Accessibility

- WCAG 2.2 AA: text ≥ 4.5:1, large text and UI parts ≥ 3:1, in both themes.
- Touch targets ≥ 48 × 48 px; spacing between targets ≥ 8 px.
- Visible focus ring (2 px `primary`, 2 px offset) on every interactive element.
- Color is never the only signal: zones also have numbers and icons; errors have icon and text.
- No global keyboard shortcuts that act while a form field has focus.
- Zone changes move focus to the zone header; live regions announce save state and preview updates politely.
- `prefers-reduced-motion` and `prefers-color-scheme` are honored.

## 9. The M3 demo: adopt, adapt, reject

| | What | Decision |
| --- | --- | --- |
| Adopt | Tonal surfaces without borders, filled fields with floating label, color-coded steps (AA tones from the demo), step header cards, sticky Back/Next footer with save status, item cards with live line total, totals card, segmented buttons, snackbar, click on the preview to jump | as specified above |
| Adapt | Linear wizard → zones that can be visited in any order and are skipped when complete | returning users must not walk through four steps |
| Adapt | HTML mock of the invoice as preview → the real Typst PDF with an overlay | an HTML copy would diverge from the PDF |
| Adapt | Swipe on the whole form and global arrow keys → swipe on zone bar/sheet only, arrows only in the zone bar | text selection, iOS back gesture, keyboard users |
| Adapt | Demo XML in a modal → real embedded XML extracted from the rendered PDF (E05 code) | must show what is actually sent |
| Adapt | Roboto, Tailwind, lucide-react → Inter (self-hosted), CSS custom properties, inline SVG icons | existing stack, no new runtime dependencies |
| Reject | "Fill example data" button that replaces the sender with another fictitious company and IBAN | creates invoices with wrong seller data |
| Reject | "ZUGFeRD 2.2" badge and "conform" claims | only claim what CI validates (EN 16931 / XRechnung, see E01) |
| Reject | `#F25D39` and `#16A34A` for text or white-on-color buttons | 3.3:1, fails AA |

## 10. PDF designs

The two current designs (*Classic*, *Modern Minimal*) differ only in title size/color, one rule under the title and zebra rows; in the picker they look identical. Phase 4 ([E11](epics/E11-distinct-pdf-designs.md)) turns designs into **clearly different characters** built from a shared layout and a small set of design tokens.

### 10.1 Invariants (all designs)

- DIN 5008 Form B positions: margins 25/20/20 mm (left/right/bottom), header area up to 45 mm, address field 45–92.4 mm (85 mm wide, franking mark top right), fold marks at 105/210 mm, punch mark at 148.5 mm. These are also the fixed preview zones 1 and 2.
- Embedded fonts only from the bundled set; the user's `settings.font` wins over a design's typography (designs vary size, weight, spacing and color, not the font family).
- User text only inside Typst string literals; PDF/A-3b; e-invoice XML attachment unchanged; watermark and signature behave the same.
- Accent color legibility: when white text is placed on the accent, the template checks the contrast and switches to dark text if the accent is too light.
- Performance stays within the E06 benchmark range (`bench_render`).

### 10.2 Design axes

| Axis | Classic | Modern Minimal (redefined) | Contrast (new, working title) |
| --- | --- | --- | --- |
| Character | traditional business letter, sober | airy, editorial, accent used sparingly | bold, brand-forward |
| Header (0–45 mm) | logo left, sender block right | small logo, sender as one muted line under it; generous white space | full-bleed accent band (0–27 mm) with sender in on-accent color, logo on a white rounded plate |
| Meta data | 3-column grid below the address | DIN information block right of the address field (from 125 mm), label/value list | tinted chips row below the address |
| Title | 15 pt bold, black | small muted type label ("Rechnung") above a large 24 pt number in accent | 18 pt bold in accent |
| Item table | rules top/bottom, light accent zebra | hairline separators only, small letter-spaced muted header | accent header row with on-accent text, rounded corners, light tint zebra |
| Totals | ruled grid, right 58 % | no rules; "Amount due" in 20 pt accent | accent-filled box with on-accent total |
| Payment block | text + EPC QR | two quiet columns (bank / QR) under a hairline | tinted card with QR |
| Footer | centered free text | left-aligned, small, muted | accent hairline above the footer |

Every design is defined as one Typst dictionary of tokens (sizes, weights, rule strokes, fills, header style, meta placement) consumed by a shared layout module, so `invoice.typ` and the five other document types cannot drift apart. A new design = one token dictionary + optional header/totals variants + allow-list entry + picker thumbnail.

### 10.3 Picker

The picker shows thumbnails rendered from the real templates (as today), a one-line character description per design, and applies the choice to the live preview immediately. Thumbnails are regenerated whenever a template changes.

## 11. Usability review (November 2026)

Heuristic review of the current app (DE/EN, light, 390 px and 1440 px). Severity: **H** high, **M** medium, **L** low. The last column names the issue that fixes it.

| # | Sev. | Finding | Fixed by |
| --- | --- | --- | --- |
| 1 | H | Mobile header uses three rows; the links "Meine Belege", "Kunden & Artikel", "E-Rechnung ansehen", "Daten & Sicherung" wrap to two lines at 390 px (~140 px chrome on Start). | E07-04 |
| 2 | H | Mobile editor: header + Form/Preview + Invoice/Sender tabs take ~200 px (~24 % of an 844 px screen) before the first field; two tab levels with unclear hierarchy. | E07-04, E08-04 |
| 3 | H | The editor opens at "Invoice", but the first hints demand changes in the other tab ("Sender & design"); the user has to leave the task. | E08-02 |
| 4 | H | The primary action is disabled without explanation when the preview failed; the error is the raw "Failed to fetch". | E08-06, E09-04 |
| 5 | M | Bordered cards inside a bordered panel, uppercase section titles with color bars and outlined inputs create visual noise. | E07-02 |
| 6 | M | "Choose saved recipient …" / "Save recipient" look like tags; small touch targets. | E07-02, E08-02 |
| 7 | M | Start: seven equal tiles with long descriptions (~220 px each on mobile, ~1,500 px scroll); the most frequent type is not emphasized. | E09-01 |
| 8 | M | Language and theme toggles and the "dev"/version badge take prime header space on every page. | E07-04 |
| 9 | M | Emoji used as icons render differently per platform. | E07-03 |
| 10 | L | Design picker: the two thumbnails are nearly identical. | E11 |

Kept because they work: auto-save status, issue summary that jumps to the field, live preview, archive follow-ups.

**Usability check protocol** (before and after phase 4, E07-05 / E08-07): five tasks, measured as taps/clicks and time by one tester on 390 px and 1440 px: (1) first invoice from scratch, (2) second invoice for a saved customer with two saved articles, (3) credit note for an issued invoice, (4) download a backup, (5) open a received e-invoice. Results go into the epic files.

## 12. Implementation rules

- Tokens in `frontend/src/styles/tokens.css`, imported by `App.css`, `landing.css`, `viewer.css` and `apiReference.css`. No hex values in components.
- Plain CSS with custom properties; no Tailwind, no CSS-in-JS, no new UI library. New runtime dependencies need a reason in the PR.
- Components in `frontend/src/components/ui/`; pages compose them.
- Migrate page by page; old and new styles may coexist during phase 4, but one page never mixes them.
- Visual verification (mandatory, see `AGENTS.md`): screenshots in DE and EN, light and dark, at 390 px and 1440 px (plus 320 px for navigation changes); PDFs rendered with `PDF_OUT=<dir> cargo test v1::tests`, rasterized and viewed for every design.
- User-visible changes get a short entry in "Neuigkeiten" (`frontend/index.html`).

### Ideas for later (not planned)

- Quick entry for items ("8 h Beratung à 95") parsed locally into a line item.
- "Like last time": prefill a new invoice for a customer from their previous document in the archive.
- Per-customer default design or language.
