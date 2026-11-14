import { useEffect, useState, type ReactNode } from 'react'
import { tr, uiLocale, useLang } from '../lib/i18n'
import {
  recipientOf,
  saveRecipient,
  searchArticles,
  searchContacts,
  setMasterData,
  getMasterData,
  sortedArticles,
  sortedContacts,
  useMasterData,
  type Article,
} from '../lib/masterData'
import { routeHref } from '../lib/router'
import { UNITS, newItem, type InvoiceItem, type Recipient } from '../lib/types'

const SHOWN = 30

export const unitLabel = (unit: string): string => UNITS.find((u) => u.value === unit)?.label ?? unit
export const money = (n: number): string => n.toLocaleString(uiLocale(), { style: 'currency', currency: 'EUR' })

interface PanelProps<T> {
  items: T[]
  search: (items: T[], query: string) => T[]
  render: (item: T) => ReactNode
  keyOf: (item: T) => string
  onPick: (item: T) => void
  emptyText: string
  manageHref: string
  manageLabel: string
  searchLabel: string
}

/** Search field and result list of a master data picker. */
function PickerPanel<T>({ items, search, render, keyOf, onPick, emptyText, manageHref, manageLabel, searchLabel }: PanelProps<T>) {
  const [query, setQuery] = useState('')
  const found = search(items, query)
  return (
    <div className="picker-panel">
      {items.length === 0 ? (
        <p className="form-hint">
          {emptyText} <a href={manageHref}>{manageLabel}</a>
        </p>
      ) : (
        <>
          <input type="text" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchLabel} aria-label={searchLabel} />
          {found.length === 0 ? (
            <p className="form-hint">{tr('Keine Treffer.', 'No matches.')}</p>
          ) : (
            <ul className="picker-list">
              {found.slice(0, SHOWN).map((item) => (
                <li key={keyOf(item)}>
                  <button type="button" onClick={() => onPick(item)}>
                    {render(item)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {found.length > SHOWN && <p className="form-hint">{tr(`${found.length - SHOWN} weitere – Suche eingrenzen.`, `${found.length - SHOWN} more – narrow the search.`)}</p>}
        </>
      )}
    </div>
  )
}

interface RecipientPickerProps {
  recipient: Recipient
  /** Called with the chosen recipient; the caller replaces all recipient fields. */
  onPick: (recipient: Recipient) => void
}

/** "Choose saved recipient" and "Save recipient" for the recipient section of every document form. */
export function RecipientPicker({ recipient, onPick }: RecipientPickerProps) {
  useLang()
  const { contacts } = useMasterData()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  // The message belongs to the recipient that was saved: drop it when the fields change
  useEffect(() => setMessage(null), [recipient])

  const save = () => {
    const { data, updated } = saveRecipient(getMasterData(), recipient)
    const ok = setMasterData(data)
    setMessage(
      !ok
        ? { text: tr('Speichern im Browser fehlgeschlagen (Speicher voll oder deaktiviert).', 'Saving in the browser failed (storage full or disabled).'), error: true }
        : { text: updated ? tr('Empfänger aktualisiert.', 'Recipient updated.') : tr('Empfänger gespeichert.', 'Recipient saved.') },
    )
  }

  return (
    <div className="picker">
      <div className="picker-actions">
        <button type="button" className="btn btn-small" aria-expanded={open} onClick={() => setOpen(!open)}>
          {tr('Gespeicherten Empfänger wählen …', 'Choose saved recipient …')}
        </button>
        <button type="button" className="btn btn-small" disabled={!recipient.name.trim()} onClick={save}>
          {tr('Empfänger speichern', 'Save recipient')}
        </button>
      </div>
      {message && (
        <p className={message.error ? 'form-error' : 'form-hint'} role="status">
          {message.text}
        </p>
      )}
      {open && (
        <PickerPanel
          items={sortedContacts(contacts)}
          search={searchContacts}
          keyOf={(c) => c.id}
          render={(c) => (
            <>
              <strong>{c.name}</strong>
              <span>{[c.address, c.city].filter(Boolean).join(', ')}</span>
            </>
          )}
          onPick={(c) => {
            onPick(recipientOf(c))
            setOpen(false)
          }}
          emptyText={tr('Noch keine Empfänger gespeichert.', 'No recipients saved yet.')}
          manageHref={routeHref('contacts')}
          manageLabel={tr('Empfänger verwalten', 'Manage recipients')}
          searchLabel={tr('Empfänger suchen …', 'Search recipients …')}
        />
      )}
    </div>
  )
}

interface ArticlePickerProps {
  /** Without prices (delivery notes) only description and unit are taken over. */
  prices: boolean
  /** Receives a new line to append; existing lines are never touched. */
  onAdd: (item: InvoiceItem) => void
}

/** "Add article" for the items section: appends a prefilled line. */
export function ArticlePicker({ prices, onAdd }: ArticlePickerProps) {
  useLang()
  const { articles } = useMasterData()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        {tr('+ Artikel aus Liste', '+ Article from list')}
      </button>
      {open && (
        <PickerPanel<Article>
          items={sortedArticles(articles)}
          search={searchArticles}
          keyOf={(a) => a.id}
          render={(a) => (
            <>
              <strong>{a.description}</strong>
              <span>{prices ? `${money(a.price)} / ${unitLabel(a.unit)} · ${a.taxRate} %` : unitLabel(a.unit)}</span>
            </>
          )}
          onPick={(a) => {
            onAdd(newItem({ description: a.description, unit: a.unit, ...(prices ? { price: a.price, taxRate: a.taxRate } : {}) }))
            setOpen(false)
          }}
          emptyText={tr('Noch keine Artikel gespeichert.', 'No articles saved yet.')}
          manageHref={routeHref('articles')}
          manageLabel={tr('Artikel verwalten', 'Manage articles')}
          searchLabel={tr('Artikel suchen …', 'Search articles …')}
        />
      )}
    </>
  )
}
