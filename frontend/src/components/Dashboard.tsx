import { useMemo, useRef, useState } from 'react'
import { AppHeader } from './AppHeader'
import { DocIcon } from './icons'
import { ThemeToggle } from './ThemeToggle'
import { DOC_SPECS, FOLLOW_UPS, docSpec, type DocKind } from '../lib/documents'
import type { ArchiveEntry } from '../lib/archive'
import { routeHref } from '../lib/router'

interface Props {
  notice: string | null
  onDismissNotice: () => void
  onImport: (file: File | undefined) => void
  onExport: () => void
  onReset: () => void
  archive: ArchiveEntry[]
  /** Numbers of invoices that already have a credit note. */
  cancelled: Set<string>
  onFollowUp: (entry: ArchiveEntry, target: DocKind) => void
  onBulk: (kind: DocKind, entries: ArchiveEntry[]) => Promise<void>
  onDeleteEntries: (ids: string[]) => void
}

/** Start page: one tile per document type (see `DOC_SPECS`). */
export function Dashboard({
  notice,
  onDismissNotice,
  onImport,
  onExport,
  onReset,
  archive,
  cancelled,
  onFollowUp,
  onBulk,
  onDeleteEntries,
}: Props) {
  const importRef = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState<DocKind | 'all'>('all')
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const visible = useMemo(() => archive.filter((e) => filter === 'all' || e.kind === filter), [archive, filter])
  const chosen = visible.filter((e) => selected.includes(e.id))
  const chosenKinds = new Set(chosen.map((e) => e.kind))
  const mixed = chosenKinds.size > 1
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const money = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })

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

  return (
    <div className="app app-scroll">
      <AppHeader>
        <ThemeToggle />
      </AppHeader>

      {notice && (
        <div className="notice" role="status" onClick={onDismissNotice}>
          {notice}
        </div>
      )}

      <main className="dashboard">
        <section className="dashboard-hero">
          <h1>Was möchten Sie erstellen?</h1>
          <p>Wählen Sie eine Dokumentart. Ihre Absenderdaten und das Design gelten für alle Dokumente.</p>
        </section>

        <ul className="tiles">
          {DOC_SPECS.map((spec) => (
            <li key={spec.kind}>
              <a
                className="tile"
                href={routeHref(spec.kind)}
                style={{ ['--tile-color' as string]: spec.color }}
              >
                <span className="tile-icon">
                  <DocIcon kind={spec.kind} size={26} />
                </span>
                <span className="tile-title">{spec.label}</span>
                <span className="tile-text">{spec.description}</span>
                <span className="tile-cta">Erstellen <span aria-hidden="true">→</span></span>
              </a>
            </li>
          ))}
        </ul>

        <section className="archive">
          <h2>Ausgestellte Belege</h2>
          {archive.length === 0 ? (
            <p>Heruntergeladene Dokumente erscheinen hier. Daraus lassen sich Stornos und Folgebelege (Angebot → Auftrag → Lieferschein → Rechnung) erstellen.</p>
          ) : (
            <>
              <div className="archive-toolbar">
                <select value={filter} onChange={(e) => setFilter(e.target.value as DocKind | 'all')} aria-label="Dokumentart filtern">
                  <option value="all">Alle Arten</option>
                  {DOC_SPECS.map((s) => (
                    <option key={s.kind} value={s.kind}>{s.label}</option>
                  ))}
                </select>
                <button className="btn" onClick={() => setSelected(visible.map((e) => e.id))}>Alle wählen</button>
                <button className="btn btn-primary" disabled={chosen.length === 0 || mixed || busy} onClick={() => void runBulk()}>
                  {busy ? 'Erstelle …' : `ZIP mit ${chosen.length} PDF`}
                </button>
                <button
                  className="btn"
                  disabled={chosen.length === 0}
                  onClick={() => {
                    if (window.confirm(`${chosen.length} Eintrag/Einträge aus dem Archiv entfernen?`)) {
                      onDeleteEntries(chosen.map((e) => e.id))
                      setSelected([])
                    }
                  }}
                >
                  Entfernen
                </button>
              </div>
              {mixed && <p className="archive-hint">Für den ZIP-Download bitte nur eine Dokumentart wählen.</p>}
              {error && <p className="archive-hint">Fehler: {error}</p>}
              <ul className="archive-list">
                {visible.map((e) => {
                  const done = e.kind === 'invoice' && cancelled.has(e.number.trim())
                  return (
                    <li key={e.id} className="archive-item">
                      <input type="checkbox" checked={selected.includes(e.id)} onChange={() => toggle(e.id)} aria-label={`${e.number} wählen`} />
                      <div className="archive-main">
                        <strong>{docSpec(e.kind)?.label} {e.number}</strong>
                        {done && <span className="badge">storniert</span>}
                        <span className="archive-sub">{e.recipient} · {new Date(e.date).toLocaleDateString('de-DE')}{e.total !== null ? ` · ${money(e.total)}` : ''}</span>
                      </div>
                      <div className="archive-actions">
                        {FOLLOW_UPS[e.kind].filter((f) => !(done && f.to === 'credit-note')).map((f) => (
                          <button key={f.to} className="btn" onClick={() => onFollowUp(e, f.to)}>{f.label}</button>
                        ))}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </section>

        <section className="dashboard-data">
          <h2>Ihre Daten</h2>
          <p>Alles wird nur in Ihrem Browser gespeichert. Sichern oder übertragen Sie Absender und Rechnung als Datei.</p>
          <div className="dashboard-data-actions">
            <button className="btn" onClick={() => importRef.current?.click()}>Importieren</button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                onImport(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <button className="btn" onClick={onExport}>Exportieren</button>
            <button className="btn" onClick={onReset}>Zurücksetzen</button>
          </div>
        </section>
      </main>
    </div>
  )
}
