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
- [ ] **E07-01 Tokens** – `frontend/src/styles/tokens.css` with the color roles, zone colors, type scale, spacing, radii and motion from the guide (light, dark, `prefers-color-scheme`); `App.css`, `landing.css`, `viewer.css`, `apiReference.css` import it; old variables are mapped to the new roles so existing pages keep working. AC: unit test computes the contrast of every text/background role pair (≥ 4.5:1, UI parts ≥ 3:1) in both themes; screenshots show no unintended change.
- [ ] **E07-02 Core components** – `components/ui/`: filled text field, select and textarea (keeping `field` keys, `data-field`, touched/revealed issue logic of `Field.tsx`/`FormIssues.tsx`), buttons (filled, tonal, text, icon, danger tonal), segmented button, chips, banner, snackbar, dialog, menu, bottom sheet. AC: keyboard and focus ring on every component; 48 px touch targets; DE/EN, light/dark, 390 px screenshots; existing form tests stay green.
- [ ] **E07-03 Icons** – One inline SVG outline set in `icons.tsx` (24 px grid, 1.75 px stroke); replace emoji used as icons (`⬇`, `🌙`, `✓`, `⚠`, `←`). AC: no emoji left in buttons/status texts; icon-only buttons have `aria-label` and tooltip.
- [ ] **E07-04 App shell and navigation** – Compact top bar (back/logo/title, one primary action, overflow menu with language, theme, version, help); global destinations *Start*, *Belege*, *Kunden*, *Mehr* with one-word labels: bottom navigation bar below 840 px, rail or top tabs from 840 px (decide once, document in the guide); backup reminder as a badge. Breakpoints move to the M3 window classes (600 / 840 px). AC: screenshots at 320, 390, 768, 1440 px in DE/EN: no wrapping, mobile chrome on Start ≤ 64 px top + 80 px bottom; every page reachable in ≤ 2 taps.
- [ ] **E07-05 Usability baseline** – Run the five-task protocol from the guide (section 11) on the current UI at 390 and 1440 px and record taps/clicks and time in this file. AC: baseline table committed before E08 starts.

## Open questions
- Navigation rail or top tabs on expanded screens? Decide in E07-04 with screenshots of both.
