# E07 – Design system and app shell

**Phase:** 4 · **Depends on:** – · **Status:** open

## Goal
Lay the foundation for the redesign: design tokens, a small component library and a new app shell whose navigation works on every screen size. Fixes the mobile navigation that wraps to two lines today.

## Context / links
- [Design guide](../16-design-guide.md) sections 3–5, 8, 11, 12 (binding).
- Today: tokens at the top of `frontend/src/App.css` (`--bg`, `--brand`, …), `landing.css`, `AppHeader.tsx`, `HeaderNav.tsx`, `LangToggle.tsx`, `ThemeToggle.tsx`, `Field.tsx`, `icons.tsx`; breakpoint 800 px.
- No new runtime dependencies (no Tailwind, no UI or icon library).

## Definition of done
- All app pages use the tokens and the new shell; nothing in the top bar or navigation wraps at 320–1440 px; DE/EN and light/dark pass AA contrast.

## Issues
- [ ] **E07-01 Tokens** – `frontend/src/styles/tokens.css` with the color roles and zone colors exactly as listed in guide 4.1 (light, dark), the high-contrast values for `prefers-contrast: more` and the `forced-colors` rules from 8.1, type scale, spacing, radii and motion; `App.css`, `landing.css`, `viewer.css`, `apiReference.css` import it; old variables (`--bg`, `--brand`, `--muted`, …) are mapped to the new roles so existing pages keep working; the header gradient and the blue focus ring are removed. *Files:* `src/styles/tokens.css` (new), `src/styles/tokens.test.ts` (new), `App.css` (lines 1–40), `landing.css`, `viewer.css`, `apiReference.css`. AC: Vitest test parses `tokens.css` and checks the contrast of every text/background pair (≥ 4.5:1, UI parts ≥ 3:1) in light, dark and both high-contrast variants; the five failures listed in guide 4.1 are gone; screenshots show no unintended layout change.
- [ ] **E07-02 Core components** – `components/ui/`: filled text field, select and textarea (keeping `field` keys, `data-field`, touched/revealed issue logic of `Field.tsx`/`FormIssues.tsx`), buttons (filled, tonal, text, icon, danger tonal), segmented button, chips, banner, snackbar, dialog, menu, bottom sheet; disabled controls stay readable in dark mode (finding 23). *Files:* `components/ui/*.tsx` (new, one file per component), `components/Field.tsx` (re-exports the new field), `App.css` (component rules move to `components/ui/ui.css`). AC: keyboard and focus ring on every component; 48 px touch targets; borders visible with `forced-colors: active`; DE/EN, light/dark, 390 px screenshots; existing tests stay green.
- [ ] **E07-03 Icons** – One inline SVG outline set in `icons.tsx` (24 px grid, 1.75 px stroke); replace emoji used as icons (`☀`, `🌙`, `⬇`, `✓`, `⚠`, `←`). *Files:* `components/icons.tsx`, every component that renders one of these characters (`grep -rn "☀\|🌙\|⬇\|✓\|⚠\|←" src`). AC: that grep returns nothing in buttons/status texts; icon-only buttons have `aria-label` and tooltip.
- [ ] **E07-04 App shell and navigation** – Compact top bar (back/logo/title, one primary action, overflow menu with language, theme *System/Light/Dark* (guide 8.1), version, help); global destinations *Start*, *Belege*, *Kunden*, *Mehr* with the glossary labels (guide 12.1): bottom navigation bar below 840 px, **tabs in the top bar from 840 px** (decided, guide 3.2); the active destination is marked by the indicator only (finding 22); backup reminder as a badge on *Mehr*; content max width 1,200 px on pages other than the editor (finding 27). Breakpoints move to the M3 window classes (600 / 840 px). *Files:* `AppHeader.tsx`, `HeaderNav.tsx`, `LangToggle.tsx`, `ThemeToggle.tsx`, `lib/theme.ts` (add `system`), `App.tsx` (routes, `#/more` page), `app/index.html` (theme before first paint). AC: screenshots at 320, 390, 768, 1440 px in DE/EN: no wrapping, mobile chrome on Start ≤ 64 px top + 80 px bottom; every page reachable in ≤ 2 taps; old hash routes (`#/documents`, `#/contacts`, `#/articles`, `#/data`, `#/viewer`, `#/buy`, `#/sender`) still work.
- [ ] **E07-05 Usability baseline and screenshot script** – Add `frontend/scripts/screenshots.mjs` (adds `playwright` as the only new devDependency, browsers via `npx playwright install chromium`; every app page in DE/EN, light/dark, 390/1440 px; mocks `/v1/*` by overriding `window.fetch` when no backend runs; seeds one issued invoice and one offer so lists are not empty; `--out <dir>`), document it in `docs/02`; then run the five-task protocol from the guide (section 11) on the current UI at 390 and 1440 px and record taps/clicks and time in this file. AC: script runs with one command on a fresh clone; baseline table committed before E08 starts.

## Decisions
- Expanded navigation: tabs in the top bar, not a rail (guide 3.2).
- Theme: *System* is the default and a real third state.
