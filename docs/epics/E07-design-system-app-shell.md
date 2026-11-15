# E07 – Design system and app shell

**Phase:** 4 · **Depends on:** – · **Status:** implementation complete; usability baseline pending · **GitHub:** [#160](https://github.com/maltinapro/pdfcraft/issues/160)

## Goal
Lay the foundation for the redesign: design tokens, a small component library and a new app shell whose navigation works on every screen size. Fixes the mobile navigation that wraps to two lines today.

## Context / links
- [Design guide](../16-design-guide.md) sections 3–5, 8, 11, 12 (binding).
- Today: tokens at the top of `frontend/src/App.css` (`--bg`, `--brand`, …), `landing.css`, `AppHeader.tsx`, `HeaderNav.tsx`, `LangToggle.tsx`, `ThemeToggle.tsx`, `Field.tsx`, `icons.tsx`; breakpoint 800 px.
- No new runtime dependencies (no Tailwind, no UI or icon library).

## Definition of done
- All app pages use the tokens and the new shell; nothing in the top bar or navigation wraps at 320–1440 px; DE/EN and light/dark pass AA contrast.

## Issues
- [x] **E07-01 Tokens** – `frontend/src/styles/tokens.css` with the color roles and zone colors exactly as listed in guide 4.1 (light, dark), the high-contrast values for `prefers-contrast: more` and the `forced-colors` rules from 8.1, type scale, spacing, radii and motion; `App.css`, `landing.css`, `viewer.css`, `apiReference.css` import it; old variables (`--bg`, `--brand`, `--muted`, …) are mapped to the new roles so existing pages keep working; the header gradient and the blue focus ring are removed. *Files:* `src/styles/tokens.css`, `src/styles/tokens.test.mjs`, `App.css`, `landing.css`, `viewer.css`, `apiReference.css`. AC: Vitest parses `tokens.css` and checks the contrast of every text/background pair (≥ 4.5:1, UI parts ≥ 3:1) in light, dark and both high-contrast variants; the five failures listed in guide 4.1 are gone; screenshots show no unintended layout change. GitHub: [#161](https://github.com/maltinapro/pdfcraft/issues/161).
- [x] **E07-02 Core components** – `components/ui/`: filled text field, select and textarea (keeping `field` keys, `data-field`, touched/revealed issue logic of `Field.tsx`/`FormIssues.tsx`), buttons (filled, tonal, text, icon, danger tonal), segmented button, chips, banner, snackbar, dialog, menu, bottom sheet; disabled controls stay readable in dark mode (finding 23). *Files:* `components/ui/*.tsx`, `components/Field.tsx`, `components/ui/ui.css`. AC: keyboard and focus ring on every component; 48 px touch targets; borders visible with `forced-colors: active`; DE/EN, light/dark, 390 px screenshots; existing tests stay green. GitHub: [#162](https://github.com/maltinapro/pdfcraft/issues/162).
- [x] **E07-03 Icons** – One inline SVG outline set in `icons.tsx` (24 px grid, 1.75 px stroke); replaced emoji used as icons (`☀`, `🌙`, `⬇`, `✓`, `⚠`, `←`). *Files:* `components/icons.tsx` and affected pages. AC: no listed emoji remain in the frontend source; icon-only buttons have `aria-label` and tooltip. GitHub: [#163](https://github.com/maltinapro/pdfcraft/issues/163).
- [x] **E07-04 App shell and navigation** – Compact top bar with overflow menu and System/Light/Dark theme; global destinations *Start*, *Belege*, *Kunden*, *Mehr*: bottom navigation below 840 px and tabs from 840 px; the active destination is marked by the indicator only; backup reminder is a badge on *Mehr*; non-editor content is max 1,200 px wide. *Files:* `AppHeader.tsx`, `HeaderNav.tsx`, `LangToggle.tsx`, `ThemeToggle.tsx`, `lib/theme.ts`, `App.tsx`, `app/index.html`. AC: no shell overflow at 320–1440 px, 240 DE/EN light/dark screenshots at 320/390/768/1440 px; old hash routes remain supported. GitHub: [#164](https://github.com/maltinapro/pdfcraft/issues/164).
- [ ] **E07-05 Usability baseline and screenshot script** – The screenshot runner is implemented in `frontend/scripts/screenshots.mjs`, seeds issued invoices/offers/customers/articles and mocks `/v1/*`; run with `npm run screenshots -- --out <dir>` after `npm install` and `npx playwright install chromium`. Verified: 240 screenshots across all app routes, DE/EN, light/dark, 320/390/768/1440 px. Remaining: run the five-task protocol from the guide (section 11) as one tester at 390 and 1440 px and record taps/clicks and time here; it cannot be honestly inferred from screenshot automation. GitHub: [#165](https://github.com/maltinapro/pdfcraft/issues/165).

## Decisions
- Expanded navigation: tabs in the top bar, not a rail (guide 3.2).
- Theme: *System* is the default and a real third state.
