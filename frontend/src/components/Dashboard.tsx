import { useRef } from 'react'
import { AppHeader } from './AppHeader'
import { DocIcon } from './icons'
import { ThemeToggle } from './ThemeToggle'
import { DOC_SPECS } from '../lib/documents'
import { routeHref } from '../lib/router'

interface Props {
  notice: string | null
  onDismissNotice: () => void
  onImport: (file: File | undefined) => void
  onExport: () => void
  onReset: () => void
}

/** Start page: one tile per document type (see `DOC_SPECS`). */
export function Dashboard({ notice, onDismissNotice, onImport, onExport, onReset }: Props) {
  const importRef = useRef<HTMLInputElement>(null)

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
