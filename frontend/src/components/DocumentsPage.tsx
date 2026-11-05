import { useMemo, useState } from 'react'
import { AppHeader } from './AppHeader'
import { ArchiveList } from './ArchiveList'
import { BackupBanner } from './BackupBanner'
import { HeaderNav } from './HeaderNav'
import { ThemeToggle } from './ThemeToggle'
import { DOC_SPECS, type DocKind } from '../lib/documents'
import type { ArchiveEntry } from '../lib/archive'
import { tr, useLang } from '../lib/i18n'
import { routeHref } from '../lib/router'

interface Props {
  notice: string | null
  onDismissNotice: () => void
  archive: ArchiveEntry[]
  cancelled: Set<string>
  onFollowUp: (entry: ArchiveEntry, target: DocKind) => void
  onBulk: (kind: DocKind, entries: ArchiveEntry[]) => Promise<void>
  onDeleteEntries: (ids: string[]) => void
  unsaved: number
  onBackup: () => void
}

/** All issued documents: filter, ZIP download, cancel / follow-up documents. */
export function DocumentsPage({ notice, onDismissNotice, archive, cancelled, onFollowUp, onBulk, onDeleteEntries, unsaved, onBackup }: Props) {
  useLang()
  const [filter, setFilter] = useState<DocKind | 'all'>('all')
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const visible = useMemo(() => archive.filter((e) => filter === 'all' || e.kind === filter), [archive, filter])
  const chosen = visible.filter((e) => selected.includes(e.id))
  const mixed = new Set(chosen.map((e) => e.kind)).size > 1
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const runBulk = async () => {
    setBusy(true)
    setError(null)
    try {
      await onBulk(chosen[0].kind, chosen)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = () => {
    const ok = window.confirm(
      tr(
        `${chosen.length} Beleg(e) aus dieser Liste entfernen? Bereits heruntergeladene PDFs bleiben auf Ihrem Computer.`,
        `Remove ${chosen.length} document(s) from this list? PDFs you already downloaded stay on your computer.`,
      ),
    )
    if (!ok) return
    onDeleteEntries(chosen.map((e) => e.id))
    setSelected([])
  }

  return (
    <div className="app app-scroll">
      <AppHeader title={tr('Meine Belege', 'My documents')}>
        <HeaderNav route="documents" unsaved={unsaved} />
        <ThemeToggle />
      </AppHeader>

      {notice && (
        <div className="notice" role="status" onClick={onDismissNotice}>
          {notice}
        </div>
      )}

      <main className="dashboard">
        <BackupBanner unsaved={unsaved} onBackup={onBackup} />

        <section className="dashboard-hero">
          <h1>{tr('Meine Belege', 'My documents')}</h1>
          <p>
            {tr(
              'Jedes heruntergeladene PDF wird hier vermerkt. Daraus lassen sich Stornos und Folgebelege (Angebot → Auftrag → Lieferschein → Rechnung) erstellen.',
              'Every PDF you download is listed here. From it you can create cancellations and follow-up documents (offer → order → delivery note → invoice).',
            )}
          </p>
        </section>

        <p className="archive-gobd" role="note">
          {tr(
            'Wichtig: Diese Liste ist eine Arbeitshilfe in Ihrem Browser – kein rechtssicheres Archiv (GoBD). Rechnungen und Gutschriften müssen Sie selbst unveränderbar aufbewahren, in der Regel 8 Jahre (Geschäftsbriefe 6 Jahre). Legen Sie die PDFs daher zusätzlich in Ihrer Buchhaltung oder Ihrem Archivsystem ab, bei E-Rechnungen samt eingebettetem XML.',
            'Important: this list is a working aid in your browser – not a legally compliant archive (GoBD). You must store invoices and credit notes yourself in an unalterable way, usually for 8 years (business letters 6 years). Please also keep the PDFs in your accounting or archive system, including the embedded XML for e-invoices.',
          )}
        </p>

        {archive.length === 0 ? (
          <section className="archive">
            <p className="archive-empty">{tr('Noch keine Belege. Erstellen Sie ein Dokument und laden Sie das PDF herunter – dann erscheint es hier.', 'No documents yet. Create a document and download the PDF – it will then appear here.')}</p>
            <a className="btn btn-primary" href={routeHref('')}>{tr('Dokument erstellen', 'Create a document')}</a>
          </section>
        ) : (
          <section className="archive">
            <div className="archive-toolbar">
              <select value={filter} onChange={(e) => setFilter(e.target.value as DocKind | 'all')} aria-label={tr('Dokumentart filtern', 'Filter by document type')}>
                <option value="all">{tr('Alle Arten', 'All types')}</option>
                {DOC_SPECS.map((s) => (
                  <option key={s.kind} value={s.kind}>{s.label}</option>
                ))}
              </select>
              <button className="btn" onClick={() => setSelected(chosen.length === visible.length ? [] : visible.map((e) => e.id))}>
                {chosen.length === visible.length ? tr('Auswahl aufheben', 'Clear selection') : tr('Alle wählen', 'Select all')}
              </button>
              <button className="btn btn-primary" disabled={chosen.length === 0 || mixed || busy} onClick={() => void runBulk()}>
                {busy ? tr('Erstelle …', 'Creating …') : chosen.length === 0 ? tr('Als ZIP herunterladen', 'Download as ZIP') : tr(`ZIP mit ${chosen.length} PDF`, `ZIP with ${chosen.length} PDF`)}
              </button>
              <button className="btn" disabled={chosen.length === 0} onClick={remove}>
                {tr('Aus Liste entfernen', 'Remove from list')}
              </button>
            </div>
            {chosen.length === 0 && <p className="archive-hint-neutral">{tr('Haken Sie Belege an, um sie gesammelt als ZIP zu laden oder zu entfernen.', 'Tick documents to download or remove them together.')}</p>}
            {mixed && <p className="archive-hint">{tr('Für den ZIP-Download bitte nur eine Dokumentart wählen.', 'For the ZIP download, please select only one document type.')}</p>}
            {error && <p className="archive-hint">{tr('Fehler', 'Error')}: {error}</p>}
            <ArchiveList entries={visible} cancelled={cancelled} onFollowUp={onFollowUp} selected={selected} onToggle={toggle} />
          </section>
        )}
      </main>
    </div>
  )
}
