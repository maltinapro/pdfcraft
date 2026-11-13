import { useSyncExternalStore } from 'react'
import { tr } from './i18n'
import { isObj, type Obj } from './storage'
import { TAX_RATES, UNITS, type InvoiceItem, type Recipient } from './types'
import type { ArchiveEntry } from './archive'
import { docSpec } from './documents'

/**
 * Customer and article master data. It lives only in this browser (`localStorage`, own key),
 * is part of the backup file and is never sent to the server except as part of a document request.
 */
export const MASTER_DATA_VERSION = 1
const STORAGE_KEY = 'pdfcraft.masterData'

/** Same limits as the backend validation (`MAX_SHORT`, `MAX_LONG`, number range). */
const MAX_SHORT = 200
const MAX_LONG = 2000
const MAX_NUMBER = 1e9
export const MAX_CONTACTS = 1000
export const MAX_ARTICLES = 1000

export interface Contact extends Recipient {
  id: string
}

/** A standard service or product: what a document line is prefilled with. */
export interface Article {
  id: string
  description: string
  /** One of `UNITS` (the e-invoice unit code mapping depends on it). */
  unit: string
  /** Net unit price in euro. */
  price: number
  /** One of `TAX_RATES`. */
  taxRate: number
}

export interface MasterData {
  contacts: Contact[]
  articles: Article[]
}

export const EMPTY_MASTER_DATA: MasterData = { contacts: [], articles: [] }

export const newMasterId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()

/** Identity of a recipient: the same customer is stored once. */
export const contactKey = (c: Recipient) => [c.name, c.address, c.city].map(normalize).join('|')

/** Identity of an article: the price is an attribute that can be updated. */
export const articleKey = (a: Pick<Article, 'description' | 'unit' | 'taxRate'>) =>
  `${normalize(a.description)}|${a.unit}|${a.taxRate}`

export const recipientOf = (c: Contact): Recipient => ({
  name: c.name,
  address: c.address,
  city: c.city,
  vatId: c.vatId,
  email: c.email,
  buyerReference: c.buyerReference,
})

const invalid = () => new Error(tr('Die Stammdaten sind ungültig.', 'The master data is invalid.'))

function str(value: unknown, max: number, required = false): string {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw invalid()
  return value
}

function parseContact(input: unknown): Contact {
  if (!isObj(input)) throw invalid()
  return {
    id: str(input.id, 64, true),
    name: str(input.name, MAX_SHORT, true),
    address: str(input.address, MAX_SHORT),
    city: str(input.city, MAX_SHORT),
    vatId: str(input.vatId, MAX_SHORT),
    email: str(input.email, MAX_SHORT),
    buyerReference: str(input.buyerReference, MAX_SHORT),
  }
}

function parseArticle(input: unknown): Article {
  if (!isObj(input)) throw invalid()
  const { unit, price, taxRate } = input
  if (typeof unit !== 'string' || !UNITS.some((u) => u.value === unit)) throw invalid()
  if (typeof price !== 'number' || !Number.isFinite(price) || Math.abs(price) > MAX_NUMBER) throw invalid()
  if (typeof taxRate !== 'number' || !(TAX_RATES as readonly number[]).includes(taxRate)) throw invalid()
  return { id: str(input.id, 64, true), description: str(input.description, MAX_LONG, true), unit, price, taxRate }
}

function parseList<T extends { id: string }>(input: unknown, parse: (e: unknown) => T, max: number): T[] {
  if (!Array.isArray(input) || input.length > max) throw invalid()
  const seen = new Set<string>()
  const out: T[] = []
  for (const entry of input) {
    const item = parse(entry)
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

/**
 * Validates a stored or imported master data object. Throws if anything is invalid, so a broken
 * file is rejected as a whole and never replaces existing data.
 */
export function parseMasterData(input: unknown): MasterData {
  if (!isObj(input)) throw invalid()
  if (typeof input.masterDataVersion !== 'number') throw invalid()
  if (input.masterDataVersion > MASTER_DATA_VERSION) {
    throw new Error(tr('Die Stammdaten stammen aus einer neueren Version.', 'The master data comes from a newer version.'))
  }
  return {
    contacts: parseList(input.contacts, parseContact, MAX_CONTACTS),
    articles: parseList(input.articles, parseArticle, MAX_ARTICLES),
  }
}

export function serializeMasterData(data: MasterData): Obj {
  return { masterDataVersion: MASTER_DATA_VERSION, contacts: data.contacts, articles: data.articles }
}

export function loadMasterData(): MasterData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? parseMasterData(JSON.parse(raw)) : EMPTY_MASTER_DATA
  } catch {
    return EMPTY_MASTER_DATA
  }
}

let persistRequested = false

/** Asks the browser not to evict the data under storage pressure; once, with the first save of real data. */
function requestPersistence(): void {
  if (persistRequested) return
  persistRequested = true
  try {
    void navigator.storage?.persist?.().catch(() => {})
  } catch {
    // ignore: not supported
  }
}

export function saveMasterData(data: MasterData): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeMasterData(data)))
  } catch {
    return false
  }
  if (data.contacts.length + data.articles.length > 0) requestPersistence()
  return true
}

export function clearMasterData(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

// --- store (shared by the master data page, the pickers and the backup) ---

let current: MasterData = loadMasterData()
const listeners = new Set<() => void>()

export const getMasterData = (): MasterData => current

/** Replaces the master data, persists it and notifies the UI. Returns false if the browser refused to store it. */
export function setMasterData(next: MasterData): boolean {
  current = next
  listeners.forEach((l) => l())
  return saveMasterData(next)
}

/** Removes everything, also from the storage (reset). */
export function resetMasterData(): void {
  clearMasterData()
  current = EMPTY_MASTER_DATA
  listeners.forEach((l) => l())
}

export function useMasterData(): MasterData {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

// --- operations (pure) ---

export const findContact = (data: MasterData, recipient: Recipient): Contact | undefined =>
  data.contacts.find((c) => contactKey(c) === contactKey(recipient))

/** Replaces the contact with the same id or adds it. */
export function withContact(data: MasterData, contact: Contact): MasterData {
  const exists = data.contacts.some((c) => c.id === contact.id)
  return {
    ...data,
    contacts: exists ? data.contacts.map((c) => (c.id === contact.id ? contact : c)) : [contact, ...data.contacts].slice(0, MAX_CONTACTS),
  }
}

export const withoutContact = (data: MasterData, id: string): MasterData => ({
  ...data,
  contacts: data.contacts.filter((c) => c.id !== id),
})

export const findArticle = (data: MasterData, article: Pick<Article, 'description' | 'unit' | 'taxRate'>): Article | undefined =>
  data.articles.find((a) => articleKey(a) === articleKey(article))

/** Replaces the article with the same id or adds it. */
export function withArticle(data: MasterData, article: Article): MasterData {
  const exists = data.articles.some((a) => a.id === article.id)
  return {
    ...data,
    articles: exists ? data.articles.map((a) => (a.id === article.id ? article : a)) : [article, ...data.articles].slice(0, MAX_ARTICLES),
  }
}

export const withoutArticle = (data: MasterData, id: string): MasterData => ({
  ...data,
  articles: data.articles.filter((a) => a.id !== id),
})

/** Stores the recipient of a document: updates the contact with the same name and address, otherwise adds one. */
export function saveRecipient(data: MasterData, recipient: Recipient): { data: MasterData; updated: boolean } {
  const existing = findContact(data, recipient)
  const contact: Contact = { ...recipient, id: existing?.id ?? newMasterId() }
  return { data: withContact(data, contact), updated: !!existing }
}

/** Stores a document line as article: updates price of the article with the same description, unit and VAT rate. */
export function saveArticleFromItem(data: MasterData, item: Pick<InvoiceItem, 'description' | 'unit' | 'price' | 'taxRate'>): { data: MasterData; updated: boolean } {
  const { description, unit, price, taxRate } = item
  const existing = findArticle(data, item)
  return {
    data: withArticle(data, { id: existing?.id ?? newMasterId(), description, unit, price, taxRate }),
    updated: !!existing,
  }
}

export interface MergeResult {
  data: MasterData
  addedContacts: number
  addedArticles: number
}

/** Adds what is not there yet (same id or same identity counts as there); existing entries always win. */
export function mergeMasterData(base: MasterData, incoming: MasterData): MergeResult {
  const ids = new Set([...base.contacts, ...base.articles].map((e) => e.id))
  const contactKeys = new Set(base.contacts.map(contactKey))
  const articleKeys = new Set(base.articles.map(articleKey))
  const contacts = [...base.contacts]
  const articles = [...base.articles]
  let addedContacts = 0
  let addedArticles = 0
  for (const c of incoming.contacts) {
    if (contacts.length >= MAX_CONTACTS || ids.has(c.id) || contactKeys.has(contactKey(c))) continue
    ids.add(c.id)
    contactKeys.add(contactKey(c))
    contacts.push(c)
    addedContacts++
  }
  for (const a of incoming.articles) {
    if (articles.length >= MAX_ARTICLES || ids.has(a.id) || articleKeys.has(articleKey(a))) continue
    ids.add(a.id)
    articleKeys.add(articleKey(a))
    articles.push(a)
    addedArticles++
  }
  return { data: { contacts, articles }, addedContacts, addedArticles }
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

/**
 * Recipients and articles of issued documents (newest first, so the newest price wins). Only documents with
 * prices provide articles; lines with a unit or VAT rate that cannot be mapped are skipped.
 */
export function masterDataFromArchive(archive: ArchiveEntry[]): MasterData {
  const contacts: Contact[] = []
  const articles: Article[] = []
  const contactKeys = new Set<string>()
  const articleKeys = new Set<string>()
  for (const entry of archive) {
    const source = entry.invoice ?? entry.doc
    if (!source) continue
    const r = source.recipient
    const recipient: Recipient = {
      name: text(r.name, MAX_SHORT),
      address: text(r.address, MAX_SHORT),
      city: text(r.city, MAX_SHORT),
      vatId: text(r.vatId, MAX_SHORT),
      email: text(r.email, MAX_SHORT),
      buyerReference: text(r.buyerReference, MAX_SHORT),
    }
    if (recipient.name && !contactKeys.has(contactKey(recipient))) {
      contactKeys.add(contactKey(recipient))
      contacts.push({ ...recipient, id: newMasterId() })
    }
    if (docSpec(entry.kind)?.items !== 'priced') continue
    for (const item of source.items ?? []) {
      const article = {
        description: text(item.description, MAX_LONG),
        unit: item.unit,
        price: item.price,
        taxRate: item.taxRate,
      }
      if (
        !article.description ||
        !UNITS.some((u) => u.value === article.unit) ||
        !(TAX_RATES as readonly number[]).includes(article.taxRate) ||
        !Number.isFinite(article.price) ||
        Math.abs(article.price) > MAX_NUMBER ||
        articleKeys.has(articleKey(article))
      ) {
        continue
      }
      articleKeys.add(articleKey(article))
      articles.push({ ...article, id: newMasterId() })
    }
  }
  return { contacts, articles }
}

const matches = (haystack: string, query: string) => {
  const terms = normalize(query).split(' ').filter(Boolean)
  const hay = normalize(haystack)
  return terms.every((t) => hay.includes(t))
}

export const searchContacts = (contacts: Contact[], query: string): Contact[] =>
  contacts.filter((c) => matches([c.name, c.address, c.city, c.vatId, c.email, c.buyerReference].join(' '), query))

export const searchArticles = (articles: Article[], query: string): Article[] =>
  articles.filter((a) => matches(a.description, query))

export const sortedContacts = (contacts: Contact[]): Contact[] =>
  [...contacts].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

export const sortedArticles = (articles: Article[]): Article[] =>
  [...articles].sort((a, b) => a.description.localeCompare(b.description, undefined, { sensitivity: 'base' }))
