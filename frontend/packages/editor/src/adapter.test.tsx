import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { EditorProvider, useAdapter, type EditorAdapter } from './adapter'
import { ArticlePicker, RecipientPicker } from './components/MasterDataPickers'
import { ItemsEditor } from './components/ItemsEditor'
import { PostageSection } from './components/PostageSection'
import { setLang } from './lib/i18n'
import { DEFAULT_SETTINGS, defaultInvoice, newItem } from './lib/types'

const rendered = { blob: new Blob(['%PDF']), zones: [] }
const minimal: EditorAdapter = { render: () => Promise.resolve(rendered) }
const full: EditorAdapter = {
  ...minimal,
  customers: { list: () => [], save: () => ({ ok: true, updated: false }) },
  articles: { list: () => [], save: () => ({ ok: true, updated: false }) },
}

const within = (adapter: EditorAdapter | null, node: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(adapter ? <EditorProvider adapter={adapter}>{node}</EditorProvider> : node)

const items = [newItem({ description: 'Beratung' })]
const recipient = defaultInvoice().recipient

beforeEach(() => setLang('en'))

describe('EditorAdapter', () => {
  it('needs only `render`: the optional parts are hidden without their source', () => {
    for (const adapter of [null, minimal]) {
      expect(within(adapter, createElement(RecipientPicker, { recipient, onPick: () => {} }))).toBe('')
      expect(within(adapter, createElement(ArticlePicker, { prices: true, onAdd: () => {} }))).toBe('')
      expect(within(adapter, createElement(PostageSection, { postage: null, onChange: () => {} }))).toBe('')
      expect(within(adapter, createElement(ItemsEditor, { items, onChange: () => {} }))).not.toContain('Save as article')
    }
  })

  it('shows the pickers and "Save as article" when the host provides customers and articles', () => {
    expect(within(full, createElement(RecipientPicker, { recipient, onPick: () => {} }))).toContain('picker')
    expect(within(full, createElement(ArticlePicker, { prices: true, onAdd: () => {} }))).toContain('Article from list')
    expect(within(full, createElement(ItemsEditor, { items, onChange: () => {} }))).toContain('Save as article')
  })

  it('has a default adapter whose render rejects with a hint to use EditorProvider', async () => {
    let seen: EditorAdapter | undefined
    const Probe = () => {
      seen = useAdapter()
      return null
    }
    renderToStaticMarkup(createElement(Probe))
    await expect(seen!.render({ kind: 'invoice', settings: DEFAULT_SETTINGS, document: defaultInvoice() }, new AbortController().signal)).rejects.toThrow('EditorProvider')
    renderToStaticMarkup(
      <EditorProvider adapter={minimal}>
        <Probe />
      </EditorProvider>,
    )
    expect(seen).toBe(minimal)
  })
})
