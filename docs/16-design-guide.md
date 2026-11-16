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
| 1 | **Sender & look** (`sender`) | company, address, contact, tax numbers, bank, logo, signature, design, accent color, font, texts, e-invoice profile | header (0–45 mm), payment block, footer | violet `#4A2FB0` / `#CABEFF` |
| 2 | **Recipient** (`recipient`) | name, address, e-mail, VAT ID, buyer reference, saved recipients, postage | address field (45–92.4 mm) | coral `#C9411E` / `#FFB4A2` |
| 3 | **Details** (`details`) | number, date, service date or period and due date (new fields, E08-08), references, subject, intro | reference line, title row | amber `#8D4E00` / `#FFB778` |
| 4 | **Items** (`items`) | line items, articles, totals, closing text | table, totals, closing | green `#006C50` / `#82D7B5` |

Per document type: the letter has **Text** (subject, body) instead of Items; the delivery note shows items without prices; credit notes add the reference to the invoice in Details. The mapping lives in one place (`ZONES` next to `DOC_SPECS` in `frontend/src/lib/documents.ts`) and is unit-tested.

Zone 1 holds settings that apply to **all** documents. Its panel says so ("Applies to all documents") and shows the same data for every type.

### 2.2 Flow

- **First run** (sender still has the example data): the editor starts at zone 1 and guides linearly: *Back* / *Next* in a sticky footer.
- **Returning user** (zone 1 complete): zone 1 shows a check in the stepper (no separate summary chip, so "Sender & look" is never shown twice) and the editor opens at the **first incomplete zone**, normally *Recipient* with the saved-recipient picker focused.
- Zones can be visited in any order: zone bar, preview tap, issue list. "Next" is a suggestion, not a gate.
- Each zone in the **stepper** (four circles joined by lines with a short label underneath, e.g. Sender, Recipient, Details, Items) shows its state: number (untouched or selected), check (complete), "!" (errors), warning icon (warnings only). Each step has its zone color (violet, coral, amber, emerald); the circle, the "Step n of 4" kicker, the focus indicator and the primary button use it. The state comes from the existing issue model (`requiredIssues`, `validateInvoice`, backend `ValidationError`, see `Workspace.tsx`).
- The last zone's footer button is the primary action: **Create PDF**; on that step the app bar's download button is hidden so there is only one primary action. Notes (warnings) are listed only on the step where they can be fixed; errors stay visible on every step. Step 1 is split by a segmented button into *Company & bank* and *Logo & look* (design, logo, signature, texts, e-invoice). After the download a success panel offers the next steps (back up, new document, follow-up document) instead of a dismissible notice.

### 2.3 Preview with zone overlay

- The preview renders the **real PDF** from the backend with pdf.js (`PdfCanvasPreview`, already a lazy chunk) for all browsers, so the overlay can be positioned exactly; the native iframe viewer is replaced. The toolbar offers zoom, page navigation, "Open PDF" and "Show e-invoice XML" (read from the rendered PDF with the E05 extractor, read-only).
- Each zone's clickable hit area follows its reported geometry; the visible outline is inset slightly so adjacent borders do not obscure the PDF. The active area is highlighted, and its label identifies the zone. Clicking an area opens that zone and focuses its first field.
- Zone geometry: zones 1 and 2 are fixed by DIN 5008. Zones 3 and 4 depend on content; the backend reports them (Typst labels queried after compiling, returned as a small JSON header, no customer data). Fallback when the header is missing: fixed DIN areas only.
- Double buffering, debouncing and "preview paused while blocking errors exist" stay as they are.

### 2.4 Layout per window size

The editor switches to its compact layout below **840 px**.

- **Expanded (≥ 840 px):** form and PDF preview sit side by side, separated by a 16 px keyboard-accessible splitter (a thin grip, no glyph). Both panes have a 360 px minimum; dragging the splitter adjusts the form share from 32 % to 58 %. The form column is a tonal surface with the sticky stepper on top and a sticky footer (save status, Back, Next / Create PDF).
- **Compact (< 840 px):** below the 56 px app bar sits one tab row, **Form | Preview** (a badge on *Form* counts open problems). *Form* shows the stepper, the active step and the footer; *Preview* shows the PDF with the zone overlay. Tapping a zone on the PDF switches to *Form* at that step. There is **no bottom navigation and no bottom sheet** in the editor (the browser already has its own bar); the global navigation is reached with the back arrow. The download button in the app bar is icon-only.
- Swiping horizontally on the form (not when the touch starts in an input, select, textarea or draggable) moves to the previous/next step; the stepper and the footer buttons are the primary controls.
- Form controls follow the natural top-to-bottom field order within each step; Tab/Shift+Tab use the browser's normal focus order. Sections inside a step are separated by a divider, not by cards; item cards (`surface-container`) are the only framed elements.
- Visual language of the editor (M3 wizard concept): tonal surfaces instead of borders and nested rounded frames, **filled text fields** with the label inside and a 2 px indicator in the zone color on focus, tonal buttons for secondary actions, a flat issue banner (error/warning container) instead of a boxed panel, and a `ZUGFeRD XML` chip plus zoom pills in the preview toolbar. The editor shell has no extra bottom padding for a navigation bar.
- The filled-field styling is scoped to the editor; the other pages (customers/articles, buy, archive) keep the earlier field styling until E09.

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
| Customers | Kunden | Customers | customers and articles (two tabs inside) |
| More | Mehr | More | check e-invoice, data & backup, buy access, language, theme, legal |

- **Compact / medium:** M3 **navigation bar** at the bottom (64 px, icon + label, active indicator pill). Replaces the header links that wrap today. On the list pages it slides away while scrolling down and returns on scroll up, at the top and at the end of the page (`lib/useHideNavOnScroll.ts`, `data-nav-hidden` on `<html>`).
- **Expanded (≥ 840 px):** the same four destinations as **tabs in the top bar** (icon + label, active indicator underneath). Decided: a navigation rail would take 80 px from the editor, which already needs form and preview side by side.
- The backup reminder is a badge on *Mehr* (dot) and on *Data & backup* inside it.

## 4. Foundations

### 4.1 Color roles

Defined once as CSS custom properties (`frontend/src/styles/tokens.css`), light and dark. Components only use roles, never hex values. The values below are **final**: copy them as they are.

**Harmony with the logo (checked with Material's HCT color model, `@material/material-color-utilities`):**

| Color | Hex | Hue | Chroma | Tone | Role |
| --- | --- | --- | --- | --- | --- |
| Logo navy | `#241259` | 296 | 42 | 13 | logo, landing hero only |
| Logo violet | `#4A2FB0` | 294 | 63 | 31 | **seed** of the app scheme, primary |
| Logo orange | `#F25D39` | 32 | 73 | 59 | logo, landing accent only (fails AA as text) |
| Recipient coral | `#C9411E` | 33 | 73 | 47 | darker tone of the logo orange |
| Details amber | `#8D4E00` | 61 | 44 | 40 | |
| Items green | `#006C50` | 162 | – | 40 | the demo's `#146C2E` harmonized towards the violet |

All neutrals are generated from the logo violet (`SchemeFidelity`, seed `#4A2FB0`), so grays carry a faint violet tint instead of today's bluish Tailwind slate (`#64748b`, `#f0f2f5`, hue ≈ 215). The coral is the logo orange at a darker tone, so violet + coral repeat the logo's two-color pairing. The demo's orange harmonized towards the violet would turn pink-red (`#B32639`), so the coral stays as it is.

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-primary` | `#4A2FB0` | `#CABEFF` | brand actions, focus, links |
| `--color-on-primary` | `#FFFFFF` | `#310498` | text/icons on primary |
| `--color-primary-container` | `#E6DEFF` | `#482CAE` | tonal buttons, selected states, nav indicator |
| `--color-on-primary-container` | `#1C0062` | `#E6DEFF` | text on primary container |
| `--color-surface` | `#FDF8FF` | `#14121A` | page background |
| `--color-surface-container-low` | `#F7F1FD` | `#1C1B22` | editor panel |
| `--color-surface-container` | `#F1ECF7` | `#201F26` | top bar, navigation bar, cards, footer bars |
| `--color-surface-container-high` | `#EBE6F1` | `#2B2931` | preview canvas, dialogs, menus |
| `--color-surface-container-highest` | `#E6E0EC` | `#36343C` | filled text fields |
| `--color-on-surface` | `#1C1B22` | `#E6E0EC` | text |
| `--color-on-surface-variant` | `#484553` | `#C9C4D6` | labels, supporting text |
| `--color-outline` | `#797585` | `#938E9F` | field indicator at rest, outlined buttons |
| `--color-outline-variant` | `#C9C4D6` | `#484553` | dividers (decorative only) |
| `--color-error` / `--color-on-error` | `#BA1A1A` / `#FFFFFF` | `#FFB4AB` / `#690005` | errors |
| `--color-error-container` / `--color-on-error-container` | `#FFDAD6` / `#93000A` | `#93000A` / `#FFDAD6` | error banner |
| `--color-warning` / `--color-warning-container` / `--color-on-warning-container` | `#8D4E00` / `#FFDCC1` / `#2E1500` | `#FFB778` / `#6C3A00` / `#FFDCC1` | warnings, example data, backup reminder |
| `--color-success` / `--color-success-container` | `#006C50` / `#9DF4D0` | `#82D7B5` / `#00513B` | saved, complete |
| `--color-scrim` | `#000000` at 32 % | `#000000` at 50 % | behind dialogs and bottom sheets |

Zone colors (`--zone-<id>`, `--zone-<id>-container`, `--zone-<id>-on-container`; the overlay tint is the zone color at 12 % opacity):

| Zone | primary L / D | container L / D | on-container L / D |
| --- | --- | --- | --- |
| sender | `#4A2FB0` / `#CABEFF` | `#E6DEFF` / `#482CAE` | `#1C0062` / `#E6DEFF` |
| recipient | `#C9411E` / `#FFB4A2` | `#FFDAD2` / `#891D00` | `#3C0700` / `#FFDAD2` |
| details | `#8D4E00` / `#FFB778` | `#FFDCC1` / `#6C3A00` | `#2E1500` / `#FFDCC1` |
| items | `#006C50` / `#82D7B5` | `#9DF4D0` / `#00513B` | `#002116` / `#9DF4D0` |

Contrast (computed): primaries on `surface` light: sender 8.6:1, recipient 4.7:1, details 6.2:1, items 6.2:1; dark primaries on `#14121A` ≥ 9:1; `on-surface-variant` on a filled field 7.2:1 (both themes); `outline` on a filled field 3.5:1 (light) / 3.9:1 (dark), enough for UI parts (≥ 3:1).

Contrast failures in today's app (fixed by E07-01, checked by its contrast test):

| Today | Ratio | Replace with |
| --- | --- | --- |
| orange "Erstellen" link / white text on orange (`#F25D39`) | 3.3:1 | filled primary button (`#4A2FB0` + white, 9.0:1) |
| petrol document-type color `#0D9488` on white | 3.7:1 | no document-type colors (see rules) |
| dark-mode brand `#7C5CE0` on `#1A1D27` | 3.6:1 | `#CABEFF` on `#14121A` (10.9:1) |
| `--muted` `#64748B` on `--bg` `#F0F2F5` | 4.2:1 | `on-surface-variant` `#484553` on `surface` |
| blue focus ring `#BFDBFE` | < 3:1 | 2 px `primary` |

Rules:
- **Accent colors are few:** primary (violet) for actions, the four zone colors inside the editor, and error/warning/success for status. Nothing else.
- **Document types have no own color.** Today's `DOC_SPECS[].color` (six Tailwind hues: `#d6336c`, `#0d9488`, `#2563eb`, `#7c3aed`, `#f25d39`, `#4a2fb0`) is removed in E09-01; tiles and archive badges use icon + label on `surface-container`/`primary-container`. Together with the zones the app showed about ten accent hues; this is the main reason it looks restless.
- Brand navy `#241259` and orange `#F25D39` belong to the logo and the landing hero, not to app controls. The app's header gradient is removed (flat `surface-container`).
- The PDF accent color (`settings.accentColor`) is document content and never tints app UI.
- Dark mode is not "inverted light": surfaces get lighter with elevation (`surface` → `surface-container-highest`); no shadows on dark surfaces except the A4 sheet; images (logo, signature) keep their colors on a white sheet.

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
- **Segmented button:** language, sender sub-sections (company & bank / logo & look), design variants; check icon in the selected segment.
- **Chips:** *assist* (zone summary "Muster GmbH ✓ Change"), *filter* (archive), *status* (open issues count in the top bar; tap = jump to the first issue).
- **Zone bar:** horizontal, 28 px number circles, 2 px connectors; label visible for the active zone (compact) or all zones (expanded); roving tabindex, arrow keys only while the bar has focus.
- **Zone header:** tonal card in the zone container color: "02 · Recipient", title, one-sentence purpose, zone icon.
- **Item card** (zone 4): card on `surface-container` with position number, live net line total, reorder (drag handle + up/down), remove; fields description, quantity + unit, unit price + VAT rate. Below the list: *Add item* (tonal, full width), *From articles* (tonal), and a totals card (net, VAT per rate, gross in `headline`).
- **Banner** (inline, top of a panel): issues and example-data hints; each entry is a link that jumps to the field. No "fill with demo data" action.
- **Dialog, menu, snackbar:** M3 standard (the editor has no bottom sheet); snackbar for transient confirmations ("Recipient saved"), never for errors that need action.
- **Empty and error states:** an icon, one sentence what happened, one action. Network errors are translated ("No connection to the PDF service – we will retry automatically") instead of raw messages such as "Failed to fetch".

## 6. Pages

- **Start (dashboard):** "What would you like to create?" with *Invoice* as a large primary card and the five other types as a compact grid (2 columns on compact, short labels, one-line description on expanded only). "Getting started" is a checklist (company details · first document · first backup) that disappears when done. Recent documents below (3 entries, link to *Belege*). The e-invoice viewer moves to *Mehr* and keeps a small link card on Start.
- **Belege, Kunden, Data & backup, Buy, Viewer:** same shell, lists as M3 list items with an overflow menu for row actions, filter chips, search field in the top bar on compact.
- **Landing and static pages** (`index.html`, SEO pages, legal pages, `/api/`): same tokens and type scale; all static pages share one header (partial `site-header.html`, styles in `src/site.css`) that collapses to logo + "Open app" + menu below 1100 px and never wraps; Swagger UI on `/api/` is themed with tokens and loaded lazily. The hero may show the zone concept (animated A4 sheet, CSS/SVG only, no JS framework, respects reduced motion). Pages stay static, fast (Lighthouse performance and accessibility ≥ 95) and without external requests.

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

### 8.1 Theme, high contrast and forced colors

- **Theme setting** has three states, *System* (default), *Light*, *Dark*, as a segmented button in *Mehr* (today a single toggle that forgets "system" after the first click). `lib/theme.ts` stores `light`/`dark` in `pdfcraft.theme`; *System* removes the key and follows `prefers-color-scheme` live. `<html data-theme>` is set before first paint (inline script in `app/index.html`, as today) so there is no flash.
- **`prefers-contrast: more`** (user asked the OS for more contrast): tokens switch to the high-contrast values of the same scheme (`SchemeFidelity`, contrast level 1): light `on-surface-variant` `#000000`, `outline` `#2D2A38`, `primary` `#2C008F`; dark `on-surface-variant` `#FFFFFF`, `outline` `#F3EDFF`, `primary` `#F3EDFF`. Filled fields additionally get a 1 px `outline` border; disabled content uses 60 % instead of 38 % opacity.
- **`forced-colors: active`** (Windows contrast themes): the browser replaces all colors. Rules: every field, button, chip, card and the zone bar has a `1px solid transparent` border in normal mode so it becomes visible; focus uses `outline` (not `box-shadow`); selected states use `Highlight`/`HighlightText`; zone tints in the preview become outlines (`CanvasText`); icons use `currentColor`. `forced-color-adjust: none` only for the PDF canvas, logo/signature images and color swatches of the accent picker.
- AC for E07: screenshots with Chrome DevTools "Emulate CSS media feature `forced-colors: active`" and `prefers-contrast: more` on Start and in the editor show every control and its boundary.

## 9. The M3 demo: adopt, adapt, reject

| | What | Decision |
| --- | --- | --- |
| Adopt | Tonal surfaces without borders, filled fields with floating label, color-coded steps (the demo's AA tones, green harmonized to `#006C50` and neutrals derived from the logo, see 4.1), step header cards, sticky Back/Next footer with save status, item cards with live line total, totals card, segmented buttons, snackbar, click on the preview to jump | as specified above |
| Adapt | Linear wizard → zones that can be visited in any order and are skipped when complete | returning users must not walk through four steps |
| Adapt | HTML mock of the invoice as preview → the real Typst PDF with an overlay | an HTML copy would diverge from the PDF |
| Adapt | Swipe on the whole form and global arrow keys → swipe on the form except when a touch starts in an input; arrows only in the stepper | text selection, iOS back gesture, keyboard users |
| Adapt | Demo XML in a modal → real embedded XML extracted from the rendered PDF (E05 code) | must show what is actually sent |
| Adapt | Roboto, Tailwind, lucide-react → Inter (self-hosted), CSS custom properties, inline SVG icons | existing stack, no new runtime dependencies |
| Reject | "Fill example data" button that replaces the sender with another fictitious company and IBAN | creates invoices with wrong seller data |
| Reject | "ZUGFeRD 2.2" badge and "conform" claims | only claim what CI validates (EN 16931 / XRechnung, see E01) |
| Reject | `#F25D39` and `#16A34A` for text or white-on-color buttons | 3.3:1, fails AA |
| Reject | The whole app (header, primary button) changing color per step | brand inconsistency; zone color only on zone elements (bar, header, focus, overlay) |

### 9.1 Side-by-side check in the browser (15 Nov 2026)

The demo was run as a Vite app and compared with the current editor (backend running, real PDF via pdf.js), same sample data, Chrome, 390 × 844 and 1440 × 900, DE, light and dark.

| Measure | Current editor | M3 demo |
| --- | --- | --- |
| Top of the first input, 390 px | 437 px | 566 px |
| Top of the first input, 1440 px | 337 px | 491 px |
| Navigation levels in the editor (mobile) | 2 (Form/Preview + Invoice/Sender) | 1 (Wizard/Preview) + stepper |
| Inputs | 38 (18 + 20 on two tabs) | 30 (no logo, signature, design, font, texts, e-invoice profile, exemption reason, contact name, postage, master-data pickers) |
| Preview | real PDF; mobile fits the width; desktop fits the width, so only ~60 % of the page is visible | HTML copy; mobile at 95 % is cut off on both sides |

What the demo does better and the zone editor must keep: one editor level, a clear header per step, Back/Next with the next step's name, item cards with a live line total, readable totals inside the form, and the active area highlighted on the sheet.

Problems found in the demo that the implementation must avoid:
- **Vertical space:** hint banner + large step header card + section card push the first field ~130–155 px lower than today. Rule: on compact screens the zone header is a single 56 px row; hints appear at the field and in the issue summary, not as a banner above the form.
- **Long labels** ("E-Mail-Adresse (für Rechnungsversand)") wrap into the value in two-column rows. Rule: labels are one line (ellipsis + full text as helper text); two-column rows only for short fields.
- **Stepper overflow:** at 1440 px the fourth step is cut ("Positio…"), on mobile only numbers are left. Rule: the zone bar shows icon + label for the active zone, icon + state for the others on compact, and never scrolls horizontally.
- **Truncated brand:** the logo text is cut to "PD" at 390 px. Rule: on compact only the logo mark is shown.
- **Mobile preview state:** after switching to the preview the segmented button still marks "Assistent". Rule: segmented buttons always reflect the visible view.
- **Dark mode:** the tonal "fill example data" button is almost invisible (on-container color on a dark container). Rule: every role pair is part of the E07-01 contrast test.

### 9.2 The demo's PDF sheet

The sheet in the demo is an HTML mock-up, not a Typst render: no DIN 5008 positions (address field not at 45 mm, no fold or punch marks), no EPC QR code, no payment block, monospaced figures, "#" in the title and web-style rounded tinted cards. It is not adopted as a design. Ideas that are adopted (see section 10 and E11): the information block to the right of the address field, a prominent amount due, a structured three-column footer (contact / bank / tax data), and separate service and due dates (E08-08).

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
| Structured footer (option, all designs) | three columns (contact / bank / tax data) built from the sender data, shown only when the free footer text is empty and the user turns it on | same, muted | same, accent labels |

Content fixes for all designs, found when comparing the rendered PDF (15 Nov 2026): the tax category letter ("19 % S", "(S)") means nothing to readers and is shown only when a document mixes categories (with a legend); the Classic zebra row reads like a selection highlight and becomes a neutral tint; "Leistungszeitraum" currently repeats the invoice date and shows the real service date once E08-08 exists.

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
| 11 | M | Item cards show no line total; the totals are only visible in the preview. On mobile the sticky save footer covers "Add item" / "Item from list". | E08-05 |
| 12 | M | Desktop preview fits the width, so only the upper ~60 % of the page is visible; there is no "whole page" fit. | E08-03 |
| 13 | M | No service date field: the PDF and the XML (`ActualDeliverySupplyChainEvent`) use the invoice date as date of service; the due date is computed (invoice date + payment days) but the PDF only says "within 14 days". | E08-08 |
| 14 | L | Hints are underlined orange link text (three lines each at 380 px sidebar width), hard to scan. | E07-02, E08-02 |
Second pass (all app pages at 390 and 1440 px, light and dark, 15 Nov 2026):

| # | Sev. | Finding | Fixed by |
| --- | --- | --- | --- |
| 15 | H | Start at 390 px: welcome card + backup banner push "Was möchten Sie erstellen?" to ~600 px; the first tile starts at ~720 px; the page is 2,680 px long. | E09-01 |
| 16 | H | Belege: backup banner and GoBD notice stand above the list, which starts at ~820 px; there is no search and no visible "download again" per row. | E09-02 |
| 17 | M | Belege: bulk actions (select all / ZIP / remove) are always visible but disabled and low-contrast until something is selected. | E09-02 |
| 18 | M | Belege: follow-up buttons say only "Rechnung" or "Auftragsbestätigung", which reads like a filter, not like "create invoice from this offer". | E09-02 |
| 19 | M | Kunden & Artikel: empty although two documents exist; "Aus ausgestellten Belegen übernehmen" has the same weight as "Neuer Kunde". | E09-03 |
| 20 | M | Terms differ for the same thing: nav "Kunden" vs. tab "Empfänger"; breadcrumb "Übersicht" vs. "Start"; "Absender & Design" vs. "Firmendaten eintragen"; "Meine Belege" vs. "Archiv". | glossary 12.1, E07-04, E09 |
| 21 | M | Daten & Sicherung: four stacked cards of equal weight; "Für Entwickler: Konfiguration für die API" sits on a user page. | E09-03 |
| 22 | M | "E-Rechnung ansehen" looks active/outlined on every page; the active page is not clearly marked. | E07-04 |
| 23 | M | Dark mode: backup banner turns olive-brown and dull; disabled buttons are hard to see; the header gradient is the same in both themes. | E07-01, E07-02 |
| 24 | M | Colors: bluish slate grays, a blue focus ring and six document-type colors next to four zone colors (about ten accent hues); five text/background pairs fail AA (table in 4.1). | E07-01, E09-01 |
| 25 | M | A failing PDF preview stayed a silent gray area (Pixel phones with an older Chrome/WebView; fixed in #158/#159, fallback "PDF öffnen"). Front-end errors are not counted, so nobody noticed. | E08-03, E12-06 |
| 26 | L | Date field shows `MM/DD/YYYY` in a German UI on some browsers (browser locale instead of UI language). | E08-02 |
| 27 | L | No designed state for windows over 1,600 px: the editor stretches; the dashboard content has no max width. | E07-04 |
| 28 | M | After the first E08 pass, the mobile zone controls could be obscured while editing, and the paper was not easy to reveal without leaving the editor. | E08 follow-up: persistent editor bar, sticky zone navigation and Show preview |
| 29 | L | Item-total labels and amounts needed clearer separation; the form also had excess inset spacing and default-looking scrollbars. | E08 follow-up: aligned label/value totals, denser section padding and themed scrollbars |
| 30 | M | The desktop form/preview balance was fixed, and zone outlines could visually crowd adjacent PDF content. | E08 follow-up: adjustable splitter and inset zone outlines |
| 31 | H | After the first E08 pass the mobile editor showed "Sender & look" twice (summary chip and zone bar), the heading ran behind the fixed navigation, the bottom navigation duplicated Chrome's own bar, and nested rounded frames and paddings used much of the screen. | M3 wizard editor: stepper with short labels, no chip, no bottom navigation, Form/Preview tabs, flat panels |

Kept because they work: auto-save status, issue summary that jumps to the field, live preview, archive follow-ups.

**Usability check protocol** (before and after phase 4, E07-05 / E08-07): five tasks, measured as taps/clicks and time by one tester on 390 px and 1440 px: (1) first invoice from scratch, (2) second invoice for a saved customer with two saved articles, (3) credit note for an issued invoice, (4) download a backup, (5) open a received e-invoice. Results go into the epic files.

For E08, automated screenshots cover 320/390/768/1440 px in DE/EN and light/dark. They are visual regression aids, not substitutes for the five-task comparison or the real-device checks in 12.2. Do not claim usability improvement until the E07-05 baseline and E08 results have both been recorded.

## 12. Implementation rules

- Tokens in `frontend/src/styles/tokens.css`, imported by `App.css`, `landing.css`, `viewer.css` and `apiReference.css`. No hex values in components.
- Plain CSS with custom properties; no Tailwind, no CSS-in-JS, no new UI library. New runtime dependencies need a reason in the PR.
- Components in `frontend/src/components/ui/`; pages compose them.
- Migrate page by page; old and new styles may coexist during phase 4, but one page never mixes them.
- Visual verification (mandatory, see `AGENTS.md`): screenshots in DE and EN, light and dark, at 390 px and 1440 px (plus 320 px for navigation changes); PDFs rendered with `PDF_OUT=<dir> cargo test v1::tests`, rasterized and viewed for every design.
- User-visible changes get a short entry in "Neuigkeiten" (`frontend/index.html`).

### 12.1 Glossary (fixed UI terms)

Use exactly these words in labels, titles, breadcrumbs, buttons and docs. One concept, one word.

| Concept | DE | EN | Not |
| --- | --- | --- | --- |
| start page | Start | Home | Übersicht, Dashboard |
| issued documents | Belege | Documents | Meine Belege, Archiv (only in the GoBD notice) |
| saved recipients | Kunden | Customers | Empfänger (only the zone name), Kontakte |
| saved line items | Artikel | Articles | Produkte, Positionen (only zone 4) |
| own company data + look | Absender & Aussehen | Sender & look | Absender & Design, Firmendaten, Einstellungen |
| zone 2 | Empfänger | Recipient | Kunde (the zone is the person on the document) |
| zone 3 | Details | Details | Rechnungsdaten, Kopf |
| zone 4 | Positionen | Items | Artikel, Leistungen |
| backup page | Daten & Sicherung | Data & backup | Export, Konfiguration |
| e-invoice viewer | E-Rechnung prüfen | Check e-invoice | E-Rechnung ansehen, Viewer |
| PDF download | PDF erstellen | Create PDF | Herunterladen, Download, Speichern |
| purchased token | Zugang kaufen | Buy access | Token kaufen (the word "Token" stays in technical texts) |
| follow-up action | „Rechnung aus diesem Angebot“ | "Invoice from this offer" | bare type names |

### 12.2 Device test matrix

The canvas preview runs on browsers we do not develop on. Every PR that touches the preview, the editor layout or pdf.js runs this matrix (real device where marked, otherwise emulation):

| Device / browser | Why | How |
| --- | --- | --- |
| Google Pixel 9, Chrome stable (**real device**) | the owner's partner's phone; Chrome Android has no in-iframe PDF viewer | open the deployed preview, edit two fields, rotate |
| Android, Chrome 2 major versions old or Android System WebView (in-app browser, e.g. links opened from mail or messenger apps) | pdf.js needs polyfills (legacy build, #158) | Playwright `devices['Pixel 7']` with `navigator.pdfViewerEnabled=false` and `Map.prototype.getOrInsertComputed`/`Math.sumPrecise` deleted |
| Samsung Internet | second-largest Android browser | real device or BrowserStack, if available |
| iPhone, Safari (current and previous iOS) | iOS shows only page 1 in iframes; on-screen keyboard and safe areas | real device or Playwright WebKit `devices['iPhone 15']` |
| Desktop Chrome, Firefox, Safari | built-in PDF viewer path | manual |
| Windows contrast theme / `forced-colors` | section 8.1 | Chrome DevTools rendering emulation |

Record the result (device, browser version, pass/fail) in the PR description.

### 12.3 Implementation playbook (for every phase-4 issue)

Written so that a contributor or a small AI model can follow it step by step without design decisions of its own. If something is not covered here or in the issue, stop and ask instead of inventing.

1. **Read** the issue in `docs/epics/EXX-*.md`, this guide's sections named in the issue, and `AGENTS.md`. Note the files listed under *Files*.
2. **Branch** from the latest `main`: `feat/<epic>-<short-name>`.
3. **Screenshots before:** `cd frontend && npm run dev`, then `node scripts/screenshots.mjs --out /tmp/before` (script added by E07-05; it covers every app page in DE/EN, light/dark, 390/1440 px and mocks the API when no backend runs).
4. **Implement** with tokens and `components/ui/` only. Keep every `field` key, `data-field` attribute, `tr()` call and localStorage key unchanged unless the issue says otherwise.
5. **Check:** `cd frontend && npm test && npm run build`; for backend changes `cd backend && cargo check && cargo test`; for template changes also `PDF_OUT=/tmp/pdf cargo test v1::tests` and look at the rasterized pages.
6. **Screenshots after** into `/tmp/after`; compare page by page. Checklist per screenshot: nothing wraps in the top bar/navigation; no hex color outside `tokens.css` (`grep -rn "#[0-9a-fA-F]\{3,6\}" src --include=*.tsx --include=*.css` only hits `tokens.css`); text readable in dark mode; focus ring visible (Tab through the page); touch targets ≥ 48 px; terms match the glossary.
7. **Docs:** tick the issue, update `docs/roadmap.md`, the epic file, `README.md`/`docs/` if behavior changed, "Neuigkeiten", `AGENTS.md`.
8. **PR:** Conventional Commits title, `Closes #<n>`, before/after screenshots, device matrix result if the preview was touched.

Do not: add dependencies the issue does not name, change API responses or the archive/backup format, use emoji as icons, add colors outside 4.1, remove features of the old UI, or add global keyboard shortcuts.

### Ideas for later (not planned)

- Quick entry for items ("8 h Beratung à 95") parsed locally into a line item.
- "Like last time": prefill a new invoice for a customer from their previous document in the archive.
- Per-customer default design or language.
