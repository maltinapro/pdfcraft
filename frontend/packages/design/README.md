# @maltinapro/design

The design system of [PDFCraft](https://github.com/maltinapro/pdfcraft) as a React package: Material Design 3 tokens
(light, dark, high contrast, forced colors), the UI components, the icon set and the theme preference. PDFCraft's own
app and the `@maltinapro/editor` package use it; other products (for example FediFinance) can use it instead of copying
the files.

The package has no dependency on the PDFCraft app or editor, calls no API and holds no texts of its own (everything
translatable is passed in by the caller). Browser storage is used only for the theme preference (`theme.ts`).

License: MIT. Changes: [CHANGELOG.md](./CHANGELOG.md). Releases: git tags `design-vX.Y.Z` (see [Releases](#releases)).

## Install

The package is published to GitHub Packages. Point the `@maltinapro` scope at it (`.npmrc`, needs a token with
`read:packages`):

```
@maltinapro:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```bash
npm install @maltinapro/design
```

Peer dependencies: `react` and `react-dom` 19. The package ships TypeScript and CSS sources (`exports` point at
`src/`), so a bundler that compiles TypeScript and resolves CSS (Vite, ...) is needed.

## Usage

```css
/* once, in the host's global stylesheet */
@import '@maltinapro/design/tokens.css';
```

```tsx
import { Button, Card, Banner, EmptyState, AppIcon, applyTheme } from '@maltinapro/design'

applyTheme('system') // sets <html data-theme="light|dark">; use storedTheme() for the saved choice

export function Example() {
  return (
    <Card heading="Documents" tone="primary">
      <Banner tone="info" onDismiss={() => {}} dismissLabel="Close">Saved locally</Banner>
      <Button variant="tonal" icon={<AppIcon name="download" size={20} />}>Download</Button>
    </Card>
  )
}
```

Importing the package also loads `ui.css` (the `.ui-*` styles, `sideEffects` lists the entry). The tokens are a
separate stylesheet because the host decides where they are loaded (static pages without React only need them).

## Contents

| Export | Description |
| --- | --- |
| `@maltinapro/design/tokens.css` | CSS custom properties: color roles (light, dark, `prefers-contrast: more`, forced colors), zone colors, type scale, spacing, radii, motion. Components use roles only, never hex values. |
| `Button`, `ButtonLink` | `filled`, `tonal`, `text`, `icon`, `danger`; the link looks like a button. |
| `Card`, `Banner`, `EmptyState`, `Snackbar` | Grouped content (`default`/`primary`/`danger`), inline messages (`info`/`warning`/`error`/`success`, `dismissLabel` names the close button), empty/error/loading pattern, transient message. |
| `Chip`, `FilterChip`, `SegmentedButton` | Assist/status chips, toggleable filter chip, segmented choice. |
| `Menu`, `MenuItem` | Overflow menu. |
| `Dialog`, `BottomSheet` | Modal `<dialog>` and its bottom-aligned variant. |
| `AppIcon`, `DocIcon`, `StatusIcon` | Inline SVG outline icons (24 px grid, 1.75 px stroke). |
| `applyTheme`, `storedTheme`, `systemTheme`, `THEME_STORAGE_KEY` | System/Light/Dark preference; `light`/`dark` is stored in `localStorage` key `pdfcraft.theme`, System removes it. |

The form fields with issue handling (`TextField`, `SelectField`, ...) belong to `@maltinapro/editor`.

## Development and tests

The package lives in the PDFCraft repository (`frontend/packages/design`, npm workspace). From `frontend/`:

```bash
npm install
npm test        # includes the contrast test, the theme test, component tests and the import boundary
npm run build
npm run screenshots -- --production   # visual check; run `npm run build` first
```

* `src/tokens.test.mjs` is the **contrast test**: every text/background role pair must reach 4.5:1 and UI boundaries
  3:1 in the light and dark scheme and in both high-contrast variants. Add new role pairs to its list.
* `src/boundary.test.ts` keeps the package independent: only `react`/`react-dom` imports, browser storage only in
  `theme.ts`, no network access.

## Releases

Versions follow SemVer in `package.json`; every change is listed in [CHANGELOG.md](./CHANGELOG.md) (changed tokens
count as changes: a color or spacing change is at least a minor version while the major version is 0). To release:
move the entries of "Unreleased" under the new version, bump `version`, merge, then push the tag `design-vX.Y.Z`
(for example `git tag design-v0.2.0 && git push origin design-v0.2.0`). The workflow
`.github/workflows/release-design-package.yml` checks that the tag matches the version, runs lint/tests/build and
publishes to GitHub Packages (`https://npm.pkg.github.com`). The package must be set to public once in the GitHub
package settings.

## License

MIT, see [LICENSE](./LICENSE).
