# @pdfcraft/editor

The paper-first document editor of [PDFCraft](https://github.com/maltinapro/pdfcraft) as a React package: the zone
model (sender, recipient, details, items, totals, …), the zone bar and panels, the clickable PDF preview with zone
overlay, the mobile editor (Form/Preview tabs, stepper) and the items zone. PDFCraft's own app uses this package.

The editor **does not read or write browser storage and does not call any API itself**. Everything it needs from its
host comes through an `EditorAdapter`: rendering the preview, saved customers and articles, Internetmarke postage and
the e-invoice XML. The document and the settings are controlled by the host through props.

License: MIT. Releases: git tags `editor-vX.Y.Z` (see [Releases](#releases)).

## Install

The package is published to GitHub Packages. Point the `@pdfcraft` scope at it (`.npmrc`, needs a token with
`read:packages`):

```
@pdfcraft:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```bash
npm install @pdfcraft/editor
```

Peer dependencies: `react` and `react-dom` 19, `pdfjs-dist` 6 (the editor imports the legacy build
`pdfjs-dist/legacy/build/pdf.mjs` and its worker for the preview on browsers without a built-in PDF viewer).
The package ships TypeScript sources (`exports` point at `src/`), so a bundler that compiles TypeScript (Vite, …) is needed.

## Usage

```tsx
import { useState } from 'react'
import { PaperEditor, defaultInvoice, DEFAULT_SETTINGS, type EditorAdapter, type Invoice } from '@pdfcraft/editor'

const adapter: EditorAdapter = {
  // The only required member: render the PDF and tell where the zones are.
  render: async ({ kind, settings, document }, signal) => {
    const response = await fetch('/my-backend/render', { method: 'POST', body: JSON.stringify({ kind, settings, document }), signal })
    return { blob: await response.blob(), zones: JSON.parse(response.headers.get('X-Zones') ?? '[]') }
  },
}

export function InvoiceEditor() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [invoice, setInvoice] = useState(defaultInvoice())
  return (
    <PaperEditor
      adapter={adapter}
      kind="invoice"
      fileName="invoice"
      settings={settings}
      onSettingsChange={setSettings}
      document={invoice}
      onDocumentChange={(next) => setInvoice(next as Invoice)}
    />
  )
}
```

`PaperEditor` is loaded lazily (its own chunk), so importing the package stays cheap.

### Host requirements

* **Design tokens and base layout.** The editor is styled with the CSS custom properties of PDFCraft's design guide
  (`docs/16-design-guide.md`); the host must define them (`import '@pdfcraft/design/tokens.css'`, see [`@pdfcraft/design`](../design/README.md); the editor depends on that package for its buttons, icons, dialog and segmented control), set the body
  font and give `#root`/`.app` the usual full-height flex layout. The package imports its own `base.css` (buttons,
  fields, dialog; eager) and `editor.css` (editor; loaded with the lazy `PaperEditor` chunk) itself.
* **Language.** The UI language lives in memory (`getLang`, `setLang`, `subscribeLang`, `useLang`, `tr(de, en)`).
  Persist it yourself (PDFCraft: `frontend/src/lib/language.ts`, key `pdfcraft.lang`) and call `setLang` at start-up.
  The language of the *document* is `settings.locale` and independent of it.

## `PaperEditor` props

| Prop | Description |
| --- | --- |
| `adapter` | The `EditorAdapter` (below). The editor wraps itself in an `EditorProvider`. |
| `kind` | `'invoice' \| 'credit-note' \| 'offer' \| 'order' \| 'delivery-note' \| 'letter'`. |
| `fileName` | Download name: `<fileName>.pdf`. |
| `settings`, `onSettingsChange` | Shared settings (sender, logo, design, bank, …). Controlled. |
| `document`, `onDocumentChange` | The document: an `Invoice` for `kind === 'invoice'`, otherwise a `Doc`. Controlled. |
| `issues` | `Issue[]` (field path + message) shown at the fields; combine `validateInvoice` / `requiredIssues` and the issues of a `ValidationError`. |
| `initialZone` | Zone that is open first. |
| `saveState` | `'saving' \| 'saved' \| 'error'`, shown in the footer. `useAutosave(deps, save)` produces it. |
| `backupHref` | Target of the "Back up" links in the footer; hidden without it. |
| `header({ downloadButton })` | Replaces the top bar. |
| `banner` | Content above the editor on wide screens. |
| `onDownloaded()` / `renderDownloaded(result)` | Called after the PDF download; the result of `onDownloaded` is passed to `renderDownloaded`, whose output fills the "PDF created" panel. Without `renderDownloaded` no panel is shown. |

## `EditorAdapter`

```ts
interface EditorAdapter {
  render(request: RenderRequest, signal: AbortSignal): Promise<RenderedPdf>
  customers?: CustomerSource
  articles?: ArticleSource
  postage?: PostageAdapter
  extractXml?(pdf: Blob, fileName: string): Promise<string | null>
  reportError?(kind: 'preview_render' | 'pdf_worker'): void
}
```

| Member | Purpose | Without it |
| --- | --- | --- |
| `render` (required) | Called (debounced, cancellable) for the live preview and the download. `RenderRequest` is `{ kind, settings, document }`. Return `{ blob, zones }`: the PDF and the `ZoneRect[]` (`zone`, `page`, `x`, `y`, `w`, `h`, fractions of the page) that make the preview clickable. Honour `signal`. Throw `ValidationError(message, issues)` for rejected data (the issues are shown at the fields) or any other `Error` for a failed request. | — |
| `customers` | Saved customers for the recipient picker and "Save recipient". | Picker hidden. |
| `articles` | Saved articles for the items zone ("Article from list", "Save as article"). | Picker hidden. |
| `postage` | Internetmarke: `loadProducts()` (`'disabled'` hides the section), optional `forgetProducts()`, `buyStamp(product, username, password)`, `recoverStamp(shopOrderId, product, username, password)`, each resolving to a `Purchase` (`{ stamp, walletBalanceCents }`). | Section hidden. |
| `extractXml` | Returns the e-invoice XML attached to the rendered PDF (or `null`). | "ZUGFeRD XML" button hidden. |
| `reportError` | Counts front-end failures. Only the kind is passed, never a message or document data. | Nothing is reported. |

`customers` and `articles` are `EntrySource`s, so they can be backed by browser storage or a server:

```ts
interface EntrySource<Entry, Saved> {
  list(): Entry[] | Promise<Entry[]>            // all entries; the editor searches/sorts them
  subscribe?(listener: () => void): () => void  // call the listener when list() changes; returns unsubscribe
  save(value: Saved): SaveResult | Promise<SaveResult> // { ok, updated }
  manageHref?: string                           // "manage" link shown in an empty picker
}
```

`Entry` is `Contact` (a `Recipient` plus `id`) for customers and `Article` (`description`, `unit`, `price`, `taxRate`
plus `id`) for articles. `save` receives a `Recipient` or `Pick<Article, 'description' | 'unit' | 'price' | 'taxRate'>`.

PDFCraft's own adapter is `frontend/src/lib/editorAdapter.ts`: `render` calls `/v1/invoices` or `/v1/documents`,
customers/articles live in the browser's master data, XML is read with the viewer's extractor.

## Other exports

The barrel also exports the document model and helpers a host needs around the editor: types and defaults
(`Settings`, `Invoice`, `Doc`, `DEFAULT_SETTINGS`, `defaultInvoice`, `defaultDoc`, `DOC_SPECS`, `ZONES`, …), parsing of
stored data (`parse*`), validation (`validateInvoice`, `requiredIssues`), `ValidationError`/`ApiError`,
`friendlyError` and the translation of backend error codes, formatting, `downloadBlob` and the form fields
`Field`/`TextField`/`SelectField`/`TextAreaField`. Since 0.2.0 `Dialog`, `SegmentedButton` and the icons (`AppIcon`,
`DocIcon`, `StatusIcon`) are no longer re-exported: import them from `@pdfcraft/design`.

## Development and tests

The package lives in the PDFCraft repository (`frontend/packages/editor`, npm workspace). From `frontend/`:

```bash
npm install
npm test        # includes the package tests (adapter contract, import boundary)
npm run build
```

`src/boundary.test.ts` keeps the package independent of the app: no imports outside `src/` except the peer
dependencies (and `@pdfcraft/design`), no `localStorage`/`sessionStorage`/`indexedDB`/`fetch`.

## Releases

Versions follow SemVer in `package.json`. To release: bump `version`, merge, then push the tag `editor-vX.Y.Z`
(for example `git tag editor-v0.2.0 && git push origin editor-v0.2.0`). The workflow
`.github/workflows/release-editor-package.yml` checks that the tag matches the version, runs lint/tests/build and
publishes to GitHub Packages (`https://npm.pkg.github.com`). The package must be set to public once in the GitHub
package settings. The editor depends on `@pdfcraft/design`: release that package first when the editor needs a new version of it. Breaking changes of the adapter interface bump the minor version while the major version is 0.

## License

MIT, see [LICENSE](./LICENSE).
