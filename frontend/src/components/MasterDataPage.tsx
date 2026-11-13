import { useState, type FormEvent } from 'react'
import { AppHeader } from './AppHeader'
import { Field, TextField } from './Field'
import { HeaderNav } from './HeaderNav'
import { money, unitLabel } from './MasterDataPickers'
import { ThemeToggle } from './ThemeToggle'
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
  const editing = tab === 'contacts' ? contact !== null : article !== null
  const full = tab === 'contacts' ? contacts.length >= MAX_CONTACTS : articles.length >= MAX_ARTICLES

  return (
    <div className="app app-scroll">
      <AppHeader title={tr('Kunden & Artikel', 'Customers & articles')}>
        <HeaderNav route="contacts" unsaved={unsaved} />
        <ThemeToggle />
      </AppHeader>

      {notice && (
        <div className="notice" role="status" onClick={onDismissNotice}>
          {notice}
        </div>
      )}

      <main className="dashboard data-page">
        <section className="dashboard-hero">
          <h1>{tr('Kunden & Artikel', 'Customers & articles')}</h1>
          <p>
            {tr(
              'Wiederkehrende Empfänger und Standardleistungen speichern und in jedem Dokument per Klick einfügen. Die Daten liegen nur in diesem Browser (nicht auf dem Server) und sind Teil der Sicherung.',
              'Save recurring recipients and standard services and add them to any document with a click. The data stays in this browser only (not on the server) and is part of the backup.',
            )}
          </p>
        </section>

        <nav className="tabs master-tabs" aria-label={tr('Stammdaten', 'Master data')}>
          <button type="button" className={`tab${tab === 'contacts' ? ' active' : ''}`} aria-current={tab === 'contacts' ? 'page' : undefined} onClick={() => goTo('contacts')}>
            {tr('Empfänger', 'Recipients')} ({contacts.length})
          </button>
          <button type="button" className={`tab${tab === 'articles' ? ' active' : ''}`} aria-current={tab === 'articles' ? 'page' : undefined} onClick={() => goTo('articles')}>
            {tr('Artikel', 'Articles')} ({articles.length})
          </button>
        </nav>

        <section className="data-card">
          <div className="archive-toolbar">
            <input
              type="text"
              className="master-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'contacts' ? tr('Empfänger suchen …', 'Search recipients …') : tr('Artikel suchen …', 'Search articles …')}
              aria-label={tab === 'contacts' ? tr('Empfänger suchen', 'Search recipients') : tr('Artikel suchen', 'Search articles')}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={editing || full}
              onClick={() => {
                setError(null)
                if (tab === 'contacts') setContact(emptyContact())
                else setArticle(emptyArticle())
              }}
            >
              {tab === 'contacts' ? tr('+ Neuer Empfänger', '+ New recipient') : tr('+ Neuer Artikel', '+ New article')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={archive.length === 0}
              title={archive.length === 0 ? tr('Noch keine Belege vorhanden', 'No documents yet') : undefined}
              onClick={onImportArchive}
            >
              {tr('Aus ausgestellten Belegen übernehmen', 'Import from issued documents')}
            </button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}

          {tab === 'contacts' && contact && (
            <form className="master-form" onSubmit={saveContact}>
              <h2>{contacts.some((c) => c.id === contact.id) ? tr('Empfänger bearbeiten', 'Edit recipient') : tr('Neuer Empfänger', 'New recipient')}</h2>
              <TextField label={tr('Name', 'Name')} value={contact.name} onChange={(v) => setContact({ ...contact, name: v.slice(0, 200) })} />
              <TextField label={tr('Straße / Hausnummer', 'Street / house number')} value={contact.address} onChange={(v) => setContact({ ...contact, address: v.slice(0, 200) })} />
              <TextField label={tr('PLZ / Ort', 'Postcode / city')} value={contact.city} onChange={(v) => setContact({ ...contact, city: v.slice(0, 200) })} />
              <TextField label={tr('E-Mail', 'E-mail')} type="email" value={contact.email} onChange={(v) => setContact({ ...contact, email: v.slice(0, 200) })} />
              <TextField label={tr('USt-IdNr.', 'VAT ID')} value={contact.vatId} onChange={(v) => setContact({ ...contact, vatId: v.slice(0, 200) })} />
              <TextField label={tr('Leitweg-ID / Käuferreferenz', 'Leitweg ID / buyer reference')} value={contact.buyerReference} onChange={(v) => setContact({ ...contact, buyerReference: v.slice(0, 200) })} />
              <div className="data-actions">
                <button type="submit" className="btn btn-primary">{tr('Speichern', 'Save')}</button>
                <button type="button" className="btn" onClick={() => { setContact(null); setError(null) }}>{tr('Abbrechen', 'Cancel')}</button>
              </div>
            </form>
          )}

          {tab === 'articles' && article && (
            <form className="master-form" onSubmit={saveArticle}>
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
              <div className="data-actions">
                <button type="submit" className="btn btn-primary">{tr('Speichern', 'Save')}</button>
                <button type="button" className="btn" onClick={() => { setArticle(null); setError(null) }}>{tr('Abbrechen', 'Cancel')}</button>
              </div>
            </form>
          )}

          {tab === 'contacts' ? (
            contacts.length === 0 ? (
              <p className="archive-empty">{tr('Noch keine Empfänger. Legen Sie einen an oder speichern Sie ihn direkt im Dokumentformular.', 'No recipients yet. Create one or save it directly in a document form.')}</p>
            ) : shownContacts.length === 0 ? (
              <p className="archive-empty">{tr('Keine Treffer.', 'No matches.')}</p>
            ) : (
              <ul className="archive-list">
                {shownContacts.map((c) => (
                  <li key={c.id} className="archive-item">
                    <div className="archive-main">
                      <strong>{c.name}</strong>
                      <span className="archive-sub">{[c.address, c.city, c.email, c.vatId].filter(Boolean).join(' · ')}</span>
                    </div>
                    <div className="archive-actions">
                      <button type="button" className="btn btn-small" onClick={() => { setError(null); setContact(c) }}>{tr('Bearbeiten', 'Edit')}</button>
                      <button type="button" className="btn btn-small btn-danger" onClick={() => removeContact(c)}>{tr('Löschen', 'Delete')}</button>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : articles.length === 0 ? (
            <p className="archive-empty">{tr('Noch keine Artikel. Legen Sie einen an oder speichern Sie eine Position direkt im Dokumentformular.', 'No articles yet. Create one or save a line directly in a document form.')}</p>
          ) : shownArticles.length === 0 ? (
            <p className="archive-empty">{tr('Keine Treffer.', 'No matches.')}</p>
          ) : (
            <ul className="archive-list">
              {shownArticles.map((a) => (
                <li key={a.id} className="archive-item">
                  <div className="archive-main">
                    <strong>{a.description}</strong>
                    <span className="archive-sub">{money(a.price)} / {unitLabel(a.unit)} · {a.taxRate} %</span>
                  </div>
                  <div className="archive-actions">
                    <button type="button" className="btn btn-small" onClick={() => { setError(null); setArticle({ ...a, price: String(a.price) }) }}>{tr('Bearbeiten', 'Edit')}</button>
                    <button type="button" className="btn btn-small btn-danger" onClick={() => removeArticle(a)}>{tr('Löschen', 'Delete')}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}
