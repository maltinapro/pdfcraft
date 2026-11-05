import { AppHeader } from './AppHeader'
import { ArchiveList } from './ArchiveList'
import { BackupBanner } from './BackupBanner'
import { DocIcon } from './icons'
import { HeaderNav } from './HeaderNav'
import { ThemeToggle } from './ThemeToggle'
import { DOC_SPECS, type DocKind } from '../lib/documents'
import type { ArchiveEntry } from '../lib/archive'
import { tr, useLang } from '../lib/i18n'
import { routeHref } from '../lib/router'

const RECENT = 3

interface Props {
  notice: string | null
  onDismissNotice: () => void
  archive: ArchiveEntry[]
  /** Numbers of invoices that already have a credit note. */
  cancelled: Set<string>
  onFollowUp: (entry: ArchiveEntry, target: DocKind) => void
  unsaved: number
  onBackup: () => void
}

/** Start page: one tile per document type (see `DOC_SPECS`) and the latest documents. */
export function Dashboard({ notice, onDismissNotice, archive, cancelled, onFollowUp, unsaved, onBackup }: Props) {
  useLang()
  return (
    <div className="app app-scroll">
      <AppHeader>
        <HeaderNav route="" unsaved={unsaved} />
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
          <h1>{tr('Was möchten Sie erstellen?', 'What would you like to create?')}</h1>
          <p>{tr('Wählen Sie eine Dokumentart. Ihre Absenderdaten und das Design gelten für alle Dokumente.', 'Choose a document type. Your sender details and design apply to all documents.')}</p>
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
                <span className="tile-cta">{tr('Erstellen', 'Create')} <span aria-hidden="true">→</span></span>
              </a>
            </li>
          ))}
        </ul>


        <section className="archive">
          <div className="section-head">
            <h2>{tr('Zuletzt erstellt', 'Recently created')}</h2>
            {archive.length > 0 && (
              <a href={routeHref('documents')}>{tr(`Alle ${archive.length} Belege anzeigen →`, `Show all ${archive.length} documents →`)}</a>
            )}
          </div>
          {archive.length === 0 ? (
            <p className="archive-empty">
              {tr(
                'Sobald Sie ein PDF herunterladen, erscheint es hier. Von dort aus können Sie es stornieren oder den nächsten Beleg daraus erstellen.',
                'Once you download a PDF it appears here. From there you can cancel it or create the next document from it.',
              )}
            </p>
          ) : (
            <ArchiveList entries={archive.slice(0, RECENT)} cancelled={cancelled} onFollowUp={onFollowUp} />
          )}
        </section>
      </main>
    </div>
  )
}
