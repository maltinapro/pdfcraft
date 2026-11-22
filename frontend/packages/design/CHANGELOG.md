# Changelog

All notable changes to `@maltinapro/pdfcraft-design` are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/),
versions follow [SemVer](https://semver.org/) (while the major version is 0, a changed token, component API or icon is
at least a minor version).

## Unreleased

## 0.1.0

First release. The files were part of the PDFCraft app (`src/styles/tokens.css`, `src/components/ui/`,
`src/lib/theme.ts`) and of `@maltinapro/pdfcraft-editor` (`icons.tsx`, `Dialog`, `SegmentedButton`) before.

### Added

- `tokens.css`: Material Design 3 color roles (light, dark, `prefers-contrast: more` for both, forced colors), zone
  colors, type scale, spacing, radii and motion tokens. Covered by the contrast test (`tokens.test.mjs`).
- `ui.css` and the components `Banner`, `BottomSheet`, `Button`, `ButtonLink`, `Card`, `Chip`, `FilterChip`, `Dialog`,
  `EmptyState`, `Menu`, `MenuItem`, `SegmentedButton`, `Snackbar`.
- Icons: `AppIcon`, `DocIcon` (`DocIconKind`), `StatusIcon`.
- Theme preference: `applyTheme`, `storedTheme`, `systemTheme`, `THEME_STORAGE_KEY`.

### Changed (compared with the copies in the app)

- `Banner` no longer translates its close button: it takes `dismissLabel` (default `Close`).
- `DocIcon` takes a `DocIconKind` (the same names as the editor's `DocKind`) instead of importing the editor's type.
