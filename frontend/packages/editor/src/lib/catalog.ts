import type { Recipient } from './types'

/** A saved recipient (customer) offered by the recipient picker. */
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

/** Lower-cases and collapses white space so that "Müller  GmbH" and "müller gmbh" are the same. */
export const normalizeText = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()

export const recipientOf = (c: Contact): Recipient => ({
  name: c.name,
  address: c.address,
  city: c.city,
  vatId: c.vatId,
  email: c.email,
  buyerReference: c.buyerReference,
})

const matches = (haystack: string, query: string) => {
  const terms = normalizeText(query).split(' ').filter(Boolean)
  const hay = normalizeText(haystack)
  return terms.every((t) => hay.includes(t))
}

export const searchContacts = (contacts: readonly Contact[], query: string): Contact[] =>
  contacts.filter((c) => matches([c.name, c.address, c.city, c.vatId, c.email, c.buyerReference].join(' '), query))

export const searchArticles = (articles: readonly Article[], query: string): Article[] =>
  articles.filter((a) => matches(a.description, query))

export const sortedContacts = (contacts: readonly Contact[]): Contact[] =>
  [...contacts].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

export const sortedArticles = (articles: readonly Article[]): Article[] =>
  [...articles].sort((a, b) => a.description.localeCompare(b.description, undefined, { sensitivity: 'base' }))
