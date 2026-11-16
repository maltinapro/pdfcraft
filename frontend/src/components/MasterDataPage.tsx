import { useState, type FormEvent } from 'react'
import { AppHeader } from './AppHeader'
import { Field, TextField } from './Field'
import { AppIcon } from './icons'
import { Banner, Button, EmptyState, Menu, MenuItem, SegmentedButton } from './ui'
import { money, unitLabel } from './MasterDataPickers'
import type { ArchiveEntry } from '../lib/archive'
import { tr, useLang } from '../lib/i18n'
import {
  MAX_ARTICLES,
  MAX_CONTACTS,
  newMasterId,
  searchArticles,
  searchContacts,
  setMasterData,
  sortedArticles,
  sortedContacts,
  useMasterData,
  withArticle,
  withContact,
  withoutArticle,
  withoutContact,
  getMasterData,
  type Article,
  type Contact,
} from '../lib/masterData'
import { routeHref } from '../lib/router'
import { TAX_RATES, UNITS } from '../lib/types'

interface Props {
  tab: 'contacts' | 'articles'
  notice: string | null
  onDismissNotice: () => void
  archive: ArchiveEntry[]
  unsaved: number
  /** Adds the recipients and articles of the issued documents that are not stored yet. */
  onImportArchive: () => void
}

const saveFailed = () =>
  tr('Speichern im Browser fehlgeschlagen (Speicher voll oder deaktiviert).', 'Saving in the browser failed (storage full or disabled).')

/** Draft of an article while editing: the price stays text so it can be typed freely. */
interface ArticleDraft extends Omit<Article, 'price'> {
  price: string
}

const emptyContact = (): Contact => ({ id: newMasterId(), name: '', address: '', city: '', vatId: '', email: '', buyerReference: '' })
const emptyArticle = (): ArticleDraft => ({ id: newMasterId(), description: '', unit: 'pcs', price: '', taxRate: 19 })

/** Recipients and articles: list, search, create, edit, delete. Everything stays in this browser. */
export function MasterDataPage({ tab, notice, onDismissNotice, archive, unsaved, onImportArchive }: Props) {
  useLang()
  const { contacts, articles } = useMasterData()
  const [query, setQuery] = useState('')
  const [contact, setContact] = useState<Contact | null>(null)
  const [article, setArticle] = useState<ArticleDraft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const goTo = (next: 'contacts' | 'articles') => {
    setQuery('')
    setContact(null)
    setArticle(null)
    setError(null)
    window.location.hash = routeHref(next)
  }

  const saveContact = (e: FormEvent) => {
    e.preventDefault()
    if (!contact) return
    if (!contact.name.trim()) return setError(tr('Bitte einen Namen eingeben.', 'Please enter a name.'))
    if (!setMasterData(withContact(getMasterData(), { ...contact, name: contact.name.trim() }))) return setError(saveFailed())
    setContact(null)
    setError(null)
  }

  const saveArticle = (e: FormEvent) => {
    e.preventDefault()
    if (!article) return
    const price = Number(article.price.replace(',', '.'))
    if (!article.description.trim()) return setError(tr('Bitte eine Beschreibung eingeben.', 'Please enter a description.'))
    if (article.price.trim() === '' || !Number.isFinite(price) || Math.abs(price) > 1e9) {
      return setError(tr('Bitte einen gültigen Preis eingeben.', 'Please enter a valid price.'))
    }
    const next: Article = { ...article, description: article.description.trim(), price }
    if (!setMasterData(withArticle(getMasterData(), next))) return setError(saveFailed())
    setArticle(null)
    setError(null)
  }

  const removeContact = (c: Contact) => {
    if (!window.confirm(tr(`Empfänger „${c.name}“ löschen? Bereits erstellte Belege bleiben unverändert.`, `Delete recipient “${c.name}”? Documents you already created stay unchanged.`))) return
    if (!setMasterData(withoutContact(getMasterData(), c.id))) setError(saveFailed())
  }

  const removeArticle = (a: Article) => {
    if (!window.confirm(tr(`Artikel „${a.description}“ löschen? Bereits erstellte Belege bleiben unverändert.`, `Delete article “${a.description}”? Documents you already created stay unchanged.`))) return
    if (!setMasterData(withoutArticle(getMasterData(), a.id))) setError(saveFailed())
  }

  const shownContacts = sortedContacts(searchContacts(contacts, query))
  const shownArticles = sortedArticles(searchArticles(articles, query))
  const importable = archive.length > 0 && (
    <Button variant="tonal" onClick={onImportArchive}>
      {tr(`Aus ${archive.length} Belegen übernehmen`, `Import from ${archive.length} documents`)}
    </Button>
  )
  const editing = tab === 'contacts' ? contact !== null : article !== null
  const full = tab === 'contacts' ? contacts.length >= MAX_CONTACTS : articles.length >= MAX_ARTICLES

  return (
    <div className="app app-scroll">
      <AppHeader title={tr('Kunden', 'Customers')} route={tab} unsaved={unsaved} />

      <main className="page page-narrow">
        {notice && <Banner onDismiss={onDismissNotice}>{notice}</Banner>}

        <h1>{tr('Kunden & Artikel', 'Customers & articles')}</h1>
        <p className="page-lead">
          {tr(
            'Wiederkehrende Kunden und Standardleistungen speichern und in jedem Dokument per Klick einfügen. Die Daten liegen nur in diesem Browser (nicht auf dem Server) und sind Teil der Sicherung.',
            'Save recurring customers and standard services and add them to any document with a click. The data stays in this browser only (not on the server) and is part of the backup.',
          )}
        </p>

        <SegmentedButton
          label={tr('Stammdaten', 'Master data')}
          value={tab}
          options={[
            { value: 'contacts', label: `${tr('Kunden', 'Customers')} (${contacts.length})` },
            { value: 'articles', label: `${tr('Artikel', 'Articles')} (${articles.length})` },
          ]}
          onChange={(next) => goTo(next as 'contacts' | 'articles')}
        />

        <div className="doc-tools">
          <label className="ui-search">
            <AppIcon name="search" size={20} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'contacts' ? tr('Kunden suchen …', 'Search customers …') : tr('Artikel suchen …', 'Search articles …')}
              aria-label={tab === 'contacts' ? tr('Kunden suchen', 'Search customers') : tr('Artikel suchen', 'Search articles')}
            />
          </label>
          <Button
            disabled={editing || full}
            onClick={() => {
              setError(null)
              if (tab === 'contacts') setContact(emptyContact())
              else setArticle(emptyArticle())
            }}
          >
            {tab === 'contacts' ? tr('Neuer Kunde', 'New customer') : tr('Neuer Artikel', 'New article')}
          </Button>
        </div>
        {error && <Banner tone="error">{error}</Banner>}

        {tab === 'contacts' && contact && (
            <form className="ui-card master-form" onSubmit={saveContact}>
              <h2>{contacts.some((c) => c.id === contact.id) ? tr('Kunde bearbeiten', 'Edit customer') : tr('Neuer Kunde', 'New customer')}</h2>
              <TextField label={tr('Name', 'Name')} value={contact.name} onChange={(v) => setContact({ ...contact, name: v.slice(0, 200) })} />
              <TextField label={tr('Straße / Hausnummer', 'Street / house number')} value={contact.address} onChange={(v) => setContact({ ...contact, address: v.slice(0, 200) })} />
              <TextField label={tr('PLZ / Ort', 'Postcode / city')} value={contact.city} onChange={(v) => setContact({ ...contact, city: v.slice(0, 200) })} />
              <TextField label={tr('E-Mail', 'E-mail')} type="email" value={contact.email} onChange={(v) => setContact({ ...contact, email: v.slice(0, 200) })} />
              <TextField label={tr('USt-IdNr.', 'VAT ID')} value={contact.vatId} onChange={(v) => setContact({ ...contact, vatId: v.slice(0, 200) })} />
              <TextField label={tr('Leitweg-ID / Käuferreferenz', 'Leitweg ID / buyer reference')} value={contact.buyerReference} onChange={(v) => setContact({ ...contact, buyerReference: v.slice(0, 200) })} />
              <div className="card-actions">
                <Button type="submit">{tr('Speichern', 'Save')}</Button>
                <Button variant="text" onClick={() => { setContact(null); setError(null) }}>{tr('Abbrechen', 'Cancel')}</Button>
              </div>
            </form>
          )}

          {tab === 'articles' && article && (
            <form className="ui-card master-form" onSubmit={saveArticle}>
              <h2>{articles.some((a) => a.id === article.id) ? tr('Artikel bearbeiten', 'Edit article') : tr('Neuer Artikel', 'New article')}</h2>
              <TextField label={tr('Beschreibung', 'Description')} value={article.description} onChange={(v) => setArticle({ ...article, description: v.slice(0, 2000) })} />
              <div className="item-row">
                <Field label={tr('Einheit', 'Unit')}>
                  <select value={article.unit} onChange={(e) => setArticle({ ...article, unit: e.target.value })}>
                    {UNITS.map((u) => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label={tr('Einzelpreis (netto)', 'Unit price (net)')}>
                  <input type="number" step="0.01" value={article.price} onChange={(e) => setArticle({ ...article, price: e.target.value })} />
                </Field>
                <Field label={tr('USt.', 'VAT')}>
                  <select value={article.taxRate} onChange={(e) => setArticle({ ...article, taxRate: Number(e.target.value) })}>
                    {TAX_RATES.map((rate) => (
                      <option key={rate} value={rate}>{rate === 0 ? tr('0 % (steuerbefreit)', '0 % (tax exempt)') : `${rate} %`}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="card-actions">
                <Button type="submit">{tr('Speichern', 'Save')}</Button>
                <Button variant="text" onClick={() => { setArticle(null); setError(null) }}>{tr('Abbrechen', 'Cancel')}</Button>
              </div>
            </form>
          )}

          {tab === 'contacts' ? (
            contacts.length === 0 ? (
              <EmptyState
                icon="customers"
                title={tr('Noch keine Kunden', 'No customers yet')}
                text={tr('Legen Sie einen Kunden an oder speichern Sie ihn direkt im Dokumentformular.', 'Create a customer or save one directly in a document form.')}
              >
                {importable}
              </EmptyState>
            ) : shownContacts.length === 0 ? (
              <EmptyState icon="search" title={tr('Keine Treffer', 'No matches')} />
            ) : (
              <ul className="master-list">
                {shownContacts.map((c) => (
                  <li key={c.id} className="master-row">
                    <button type="button" className="master-row-main" onClick={() => { setError(null); setContact(c) }}>
                      <strong>{c.name}</strong>
                      <span>{[c.address, c.city, c.email, c.vatId].filter(Boolean).join(' · ')}</span>
                    </button>
                    <Menu label={tr(`Aktionen für ${c.name}`, `Actions for ${c.name}`)}>
                      <MenuItem onClick={() => { setError(null); setContact(c) }}>{tr('Bearbeiten', 'Edit')}</MenuItem>
                      <MenuItem danger onClick={() => removeContact(c)}>{tr('Löschen', 'Delete')}</MenuItem>
                    </Menu>
                  </li>
                ))}
              </ul>
            )
          ) : articles.length === 0 ? (
            <EmptyState
              icon="articles"
              title={tr('Noch keine Artikel', 'No articles yet')}
              text={tr('Legen Sie einen Artikel an oder speichern Sie eine Position direkt im Dokumentformular.', 'Create an article or save a line directly in a document form.')}
            >
              {importable}
            </EmptyState>
          ) : shownArticles.length === 0 ? (
            <EmptyState icon="search" title={tr('Keine Treffer', 'No matches')} />
          ) : (
            <ul className="master-list">
              {shownArticles.map((a) => (
                <li key={a.id} className="master-row">
                  <button type="button" className="master-row-main" onClick={() => { setError(null); setArticle({ ...a, price: String(a.price) }) }}>
                    <strong>{a.description}</strong>
                    <span>{money(a.price)} / {unitLabel(a.unit)} · {a.taxRate} %</span>
                  </button>
                  <Menu label={tr(`Aktionen für ${a.description}`, `Actions for ${a.description}`)}>
                    <MenuItem onClick={() => { setError(null); setArticle({ ...a, price: String(a.price) }) }}>{tr('Bearbeiten', 'Edit')}</MenuItem>
                    <MenuItem danger onClick={() => removeArticle(a)}>{tr('Löschen', 'Delete')}</MenuItem>
                  </Menu>
                </li>
              ))}
            </ul>
          )}

          {(contacts.length > 0 || articles.length > 0) && archive.length > 0 && (
            <div className="card-actions">{importable}</div>
          )}
      </main>
    </div>
  )
}
