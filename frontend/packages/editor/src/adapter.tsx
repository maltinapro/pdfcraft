import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Article, Contact } from './lib/catalog'
import type { Doc, DocKind, ZoneRect } from './lib/documents'
import type { Invoice, PostageStamp, Recipient, Settings } from './lib/types'

/** What the editor asks the host to render. `document` is an `Invoice` for `kind === 'invoice'`, otherwise a `Doc`. */
export interface RenderRequest {
  kind: DocKind
  settings: Settings
  document: Invoice | Doc
}

/** A rendered PDF with the position of the editable zones (for the clickable preview). */
export interface RenderedPdf {
  blob: Blob
  zones: ZoneRect[]
}

type MaybePromise<T> = T | Promise<T>

/** Result of saving a customer or an article. `ok` is false when the host could not store it. */
export interface SaveResult {
  ok: boolean
  /** An existing entry was changed instead of a new one added. */
  updated: boolean
}

/** A list the pickers read from; the host decides where it lives (browser storage, a server, …). */
export interface EntrySource<Entry, Saved> {
  /** All entries. The editor searches and sorts them itself. */
  list(): MaybePromise<readonly Entry[]>
  /** Called after `list` would return something else; returns the unsubscribe function. */
  subscribe?(listener: () => void): () => void
  /** Saves the recipient of the document / a document line as an entry. */
  save(value: Saved): MaybePromise<SaveResult>
  /** Page where the user manages the entries; shown as a link in an empty picker. */
  manageHref?: string
}

export type CustomerSource = EntrySource<Contact, Recipient>
export type ArticleSource = EntrySource<Article, Pick<Article, 'description' | 'unit' | 'price' | 'taxRate'>>

export interface PostageProduct {
  productCode: number
  name: string
  priceCents: number
}

export interface ProductList {
  products: PostageProduct[]
  /** Test stamps: not valid for postage, no real money. */
  sandbox: boolean
  /** `false` when no user login is needed. */
  loginRequired: boolean
}

export type Products = ProductList | 'disabled'

export interface Purchase {
  stamp: PostageStamp
  walletBalanceCents: number | null
}

/** Internetmarke. Without this adapter the postage section is not shown. */
export interface PostageAdapter {
  /** `'disabled'` hides the section. */
  loadProducts(): Promise<Products>
  /** Forgets cached products (called when a price changed). */
  forgetProducts?(): void
  buyStamp(product: PostageProduct, username: string, password: string): Promise<Purchase>
  recoverStamp(shopOrderId: string, product: Pick<PostageProduct, 'name' | 'priceCents'>, username: string, password: string): Promise<Purchase>
}

/** Front-end failures a host may count. Only the kind is passed, never a message or document data. */
export type EditorErrorKind = 'preview_render' | 'pdf_worker'

/**
 * Everything the editor needs from its host. Only `render` is required; the editor does not read
 * or write any browser storage itself. Documents and settings are controlled by the host through
 * the `PaperEditor` props.
 */
export interface EditorAdapter {
  /**
   * Renders the PDF for the live preview. Throw a `ValidationError` for rejected data (its issues
   * are shown at the fields) and any other error for a failed request. Honour `signal`.
   */
  render(request: RenderRequest, signal: AbortSignal): Promise<RenderedPdf>
  /** Saved customers for the recipient picker. Without it the picker is hidden. */
  customers?: CustomerSource
  /** Saved articles for the items zone. Without it the picker and "Save as article" are hidden. */
  articles?: ArticleSource
  /** Internetmarke postage. Without it the section is hidden. */
  postage?: PostageAdapter
  /** Returns the e-invoice XML attached to a rendered PDF, or `null`. Without it the "ZUGFeRD XML" button is hidden. */
  extractXml?(pdf: Blob, fileName: string): Promise<string | null>
  /** Called when the preview cannot be drawn. */
  reportError?(kind: EditorErrorKind): void
}

const NO_ADAPTER: EditorAdapter = {
  render: () => Promise.reject(new Error('No EditorAdapter: wrap the editor in <EditorProvider adapter={…}>.')),
}

const AdapterContext = createContext<EditorAdapter>(NO_ADAPTER)

export function EditorProvider({ adapter, children }: { adapter: EditorAdapter; children: ReactNode }) {
  return <AdapterContext.Provider value={adapter}>{children}</AdapterContext.Provider>
}

export const useAdapter = (): EditorAdapter => useContext(AdapterContext)

/** Entries of a source (`null` while loading); reloads when the source announces a change. */
export function useEntries<Entry>(source: Pick<EntrySource<Entry, never>, 'list' | 'subscribe'> | undefined, enabled = true): readonly Entry[] | null {
  const [entries, setEntries] = useState<readonly Entry[] | null>(null)
  useEffect(() => {
    if (!source || !enabled) return
    let current = true
    const load = () => {
      void Promise.resolve(source.list()).then(
        (list) => current && setEntries(list),
        () => current && setEntries([]),
      )
    }
    load()
    const unsubscribe = source.subscribe?.(load)
    return () => {
      current = false
      unsubscribe?.()
    }
  }, [source, enabled])
  return entries
}
