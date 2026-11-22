import { useMemo, useState } from 'react'
import { AppHeader } from './AppHeader'
import { ArchiveList } from './ArchiveList'
import { DOC_SPECS, type DocKind, friendlyError, tr, useLang } from '@maltinapro/pdfcraft-editor'
import { AppIcon, Banner, Button, ButtonLink, EmptyState, FilterChip } from '@maltinapro/pdfcraft-design'
import type { ArchiveEntry } from '../lib/archive'
import { NO_FILTER, filterEntries, isFiltered, type ArchiveFilter, type EntryStatus } from '../lib/archiveFilter'
import { routeHref } from '../lib/router'

interface Props {
  notice: string | null
  onDismissNotice: () => void
  archive: ArchiveEntry[]
  statuses: Map<string, EntryStatus>
  onFollowUp: (entry: ArchiveEntry, target: DocKind) => void
  onRerender: (entry: ArchiveEntry) => void
  onBulk: (kind: DocKind, entries: ArchiveEntry[]) => Promise<void>
  onDeleteEntries: (ids: string[]) => void
  unsaved: number
}

/** All issued documents: search, filter chips, row menu (re-create, follow-ups, remove) and a selection mode for ZIP / remove. */
export function DocumentsPage({ notice, onDismissNotice, archive, statuses, onFollowUp, onRerender, onBulk, onDeleteEntries, unsaved }: Props) {
  useLang()
  const [filter, setFilter] = useState<ArchiveFilter>(NO_FILTER)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const visible = useMemo(() => filterEntries(archive, filter), [archive, filter])
  const chosen = visible.filter((e) => selected.includes(e.id))
  const mixed = new Set(chosen.map((e) => e.kind)).size > 1
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const patch = (next: Partial<ArchiveFilter>) => setFilter((f) => ({ ...f, ...next }))
  const stopSelecting = () => {
    setSelecting(false)
    setSelected([])
  }

  const runBulk = async () => {
    setBusy(true)
    setError(null)
    try {
      await onBulk(chosen[0].kind, chosen)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const confirmRemove = (entries: ArchiveEntry[]): boolean =>
    window.confirm(
      tr(
        `${entries.length} Beleg(e) aus dieser Liste entfernen? Bereits heruntergeladene PDFs bleiben auf Ihrem Computer.`,
        `Remove ${entries.length} document(s) from this list? PDFs you already downloaded stay on your computer.`,
      ),
    )

  const removeChosen = () => {
    if (!confirmRemove(chosen)) return
    onDeleteEntries(chosen.map((e) => e.id))
    stopSelecting()
  }

  const removeOne = (entry: ArchiveEntry) => {
    if (confirmRemove([entry])) onDeleteEntries([entry.id])
  }

  const longPress = (id: string) => {
    setSelecting(true)
    setSelected((s) => (s.includes(id) ? s : [...s, id]))
  }

  return (
    <div className="app app-scroll">
      <AppHeader title={tr('Belege', 'Documents')} route="documents" unsaved={unsaved} />

      <main className="page page-documents">
        {notice && <Banner dismissLabel={tr('Schließen', 'Close')} onDismiss={onDismissNotice}>{notice}</Banner>}

        {archive.length === 0 ? (
          <EmptyState
            icon="documents"
            title={tr('Noch keine Belege', 'No documents yet')}
            text={tr('Erstellen Sie ein Dokument und laden Sie das PDF herunter – dann erscheint es hier.', 'Create a document and download the PDF – it will then appear here.')}
          >
            <ButtonLink href={routeHref('')}>{tr('Dokument erstellen', 'Create a document')}</ButtonLink>
          </EmptyState>
        ) : (
          <>
            <div className="doc-tools">
              <label className="ui-search">
                <AppIcon name="search" size={20} />
                <input
                  type="search"
                  value={filter.query}
                  onChange={(e) => patch({ query: e.target.value })}
                  placeholder={tr('Nummer, Kunde oder Art suchen …', 'Search number, customer or type …')}
                  aria-label={tr('Belege durchsuchen', 'Search documents')}
                />
              </label>
              <Button variant="tonal" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
                {selecting ? tr('Fertig', 'Done') : tr('Auswählen', 'Select')}
              </Button>
            </div>

            <div className="chip-row" role="group" aria-label={tr('Filter', 'Filters')}>
              {DOC_SPECS.map((spec) => (
                <FilterChip key={spec.kind} selected={filter.kind === spec.kind} onClick={() => patch({ kind: filter.kind === spec.kind ? null : spec.kind })}>
                  {spec.label}
                </FilterChip>
              ))}
              <FilterChip selected={filter.period === 'month'} onClick={() => patch({ period: filter.period === 'month' ? null : 'month' })}>
                {tr('Dieser Monat', 'This month')}
              </FilterChip>
              <FilterChip selected={filter.period === 'year'} onClick={() => patch({ period: filter.period === 'year' ? null : 'year' })}>
                {tr('Dieses Jahr', 'This year')}
              </FilterChip>
              <FilterChip selected={filter.cancelled} onClick={() => patch({ cancelled: !filter.cancelled })}>
                {tr('Storniert', 'Cancelled')}
              </FilterChip>
            </div>

            <details className="gobd-note">
              <summary>
                {tr('Keine rechtssichere Archivierung (GoBD). ', 'Not a legally compliant archive (GoBD). ')}
                <strong>{tr('Mehr erfahren', 'Learn more')}</strong>
              </summary>
              <p role="note">
                {tr(
                  'Diese Liste ist eine Arbeitshilfe in Ihrem Browser – kein rechtssicheres Archiv (GoBD). Rechnungen und Gutschriften müssen Sie selbst unveränderbar aufbewahren, in der Regel 8 Jahre (Geschäftsbriefe 6 Jahre). Legen Sie die PDFs daher zusätzlich in Ihrer Buchhaltung oder Ihrem Archivsystem ab, bei E-Rechnungen samt eingebettetem XML.',
                  'This list is a working aid in your browser – not a legally compliant archive (GoBD). You must store invoices and credit notes yourself in an unalterable way, usually for 8 years (business letters 6 years). Please also keep the PDFs in your accounting or archive system, including the embedded XML for e-invoices.',
                )}
              </p>
            </details>

            {error && <Banner tone="error" dismissLabel={tr('Schließen', 'Close')} onDismiss={() => setError(null)}>{tr('Fehler', 'Error')}: {error}</Banner>}

            {visible.length === 0 ? (
              <EmptyState icon="search" title={tr('Keine Treffer', 'No matches')} text={tr('Passen Sie Suche oder Filter an.', 'Adjust the search or the filters.')}>
                {isFiltered(filter) && <Button variant="tonal" onClick={() => setFilter(NO_FILTER)}>{tr('Filter zurücksetzen', 'Reset filters')}</Button>}
              </EmptyState>
            ) : (
              <ArchiveList
                entries={visible}
                statuses={statuses}
                onFollowUp={onFollowUp}
                onRerender={onRerender}
                onDelete={removeOne}
                selecting={selecting}
                selected={selected}
                onToggle={toggle}
                onLongPress={longPress}
              />
            )}

            {selecting && (
              <div className="selection-bar" role="region" aria-label={tr('Auswahl', 'Selection')}>
                <strong>{tr(`${chosen.length} ausgewählt`, `${chosen.length} selected`)}</strong>
                <Button variant="text" onClick={() => setSelected(chosen.length === visible.length ? [] : visible.map((e) => e.id))}>
                  {chosen.length === visible.length ? tr('Keine', 'None') : tr('Alle', 'All')}
                </Button>
                <Button variant="tonal" disabled={chosen.length === 0 || mixed || busy} onClick={() => void runBulk()}>
                  {busy ? tr('Erstelle …', 'Creating …') : tr('ZIP', 'ZIP')}
                </Button>
                <Button variant="danger" disabled={chosen.length === 0 || busy} onClick={removeChosen}>
                  {tr('Entfernen', 'Remove')}
                </Button>
                {mixed && <p className="selection-hint">{tr('Für den ZIP-Download bitte nur eine Dokumentart wählen.', 'For the ZIP download, please select only one document type.')}</p>}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
