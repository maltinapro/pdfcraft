import { AppHeader } from './AppHeader'
import { ArchiveList } from './ArchiveList'
import { FreeVersionHint } from './FreeVersionHint'
import { DOC_SPECS, type DocKind, docSpec, tr, useLang } from '@pdfcraft/editor'
import { AppIcon, DocIcon, Banner, Card, EmptyState } from '@pdfcraft/design'
import type { ArchiveEntry } from '../lib/archive'
import type { EntryStatus } from '../lib/archiveFilter'
import { onboardingOpen, onboardingSteps } from '../lib/onboarding'
import { routeHref } from '../lib/router'

const RECENT = 3

interface Props {
  notice: string | null
  onDismissNotice: () => void
  archive: ArchiveEntry[]
  statuses: Map<string, EntryStatus>
  onFollowUp: (entry: ArchiveEntry, target: DocKind) => void
  onRerender: (entry: ArchiveEntry) => void
  unsaved: number
  /** The sender no longer shows the example data. */
  companyDone: boolean
  lastBackup: string | null
}

/** Start page: the invoice is one tap away, the other document types follow, then getting started and the latest documents. */
export function Dashboard({ notice, onDismissNotice, archive, statuses, onFollowUp, onRerender, unsaved, companyDone, lastBackup }: Props) {
  useLang()
  const invoice = docSpec('invoice')
  const others = DOC_SPECS.filter((spec) => spec.kind !== 'invoice')
  const steps = onboardingSteps({ companyDone, documents: archive.length, lastBackup })
  return (
    <div className="app app-scroll">
      <AppHeader route="" unsaved={unsaved} />

      <main className="page">
        {notice && <Banner dismissLabel={tr('Schließen', 'Close')} onDismiss={onDismissNotice}>{notice}</Banner>}

        <h1>{tr('Was möchten Sie erstellen?', 'What would you like to create?')}</h1>

        {invoice && (
          <a className="start-primary" href={routeHref('invoice')}>
            <span className="start-primary-icon"><DocIcon kind="invoice" size={28} /></span>
            <span>
              <strong>{invoice.label}</strong>
              <small>{tr('Mit E-Rechnung (ZUGFeRD, XRechnung) und Live-Vorschau', 'With e-invoice (ZUGFeRD, XRechnung) and live preview')}</small>
            </span>
            <AppIcon name="forward" />
          </a>
        )}

        <ul className="start-grid">
          {others.map((spec) => (
            <li key={spec.kind}>
              <a className="start-tile" href={routeHref(spec.kind)}>
                <span className="start-tile-icon"><DocIcon kind={spec.kind} size={22} /></span>
                <span className="start-tile-text">
                  <span className="start-tile-title">{spec.label}</span>
                  <span className="start-tile-desc">{spec.description}</span>
                </span>
              </a>
            </li>
          ))}
          <li>
            <a className="start-tile" href={routeHref('viewer')}>
              <span className="start-tile-icon"><AppIcon name="viewer" size={22} /></span>
              <span className="start-tile-text">
                <span className="start-tile-title">{tr('E-Rechnung prüfen', 'Check e-invoice')}</span>
                <span className="start-tile-desc">
                  {tr('Empfangene ZUGFeRD- oder XRechnung-Datei lesen und prüfen. Bleibt in Ihrem Browser.', 'Read and check a received ZUGFeRD or XRechnung file. It stays in your browser.')}
                </span>
              </span>
            </a>
          </li>
        </ul>

        {onboardingOpen(steps) && (
          <Card heading={tr('Erste Schritte', 'Getting started')} aria-label={tr('Erste Schritte', 'Getting started')}>
            <ul className="checklist">
              {steps.map((step) => (
                <li key={step.id} className={step.done ? 'checklist-done' : undefined}>
                  <a href={routeHref(step.route)}>
                    <span className="checklist-mark" aria-hidden="true"><AppIcon name="check" size={16} /></span>
                    <span className="checklist-label">{step.label}</span>
                    <span className="sr-only">{step.done ? tr('erledigt', 'done') : tr('offen', 'open')}</span>
                    {!step.done && <span className="checklist-go" aria-hidden="true"><AppIcon name="forward" size={20} /></span>}
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <FreeVersionHint />

        <section aria-labelledby="recent-heading">
          <div className="page-section-head">
            <h2 id="recent-heading">{tr('Zuletzt erstellt', 'Recently created')}</h2>
            {archive.length > RECENT && (
              <a href={routeHref('documents')}>{tr(`Alle ${archive.length} anzeigen`, `Show all ${archive.length}`)}</a>
            )}
          </div>
          {archive.length === 0 ? (
            <EmptyState
              icon="documents"
              title={tr('Noch keine Belege', 'No documents yet')}
              text={tr('Sobald Sie ein PDF herunterladen, erscheint es hier – mit Stornieren und Folgebelegen.', 'Once you download a PDF it appears here – with cancel and follow-up documents.')}
            />
          ) : (
            <ArchiveList entries={archive.slice(0, RECENT)} statuses={statuses} onFollowUp={onFollowUp} onRerender={onRerender} />
          )}
        </section>
      </main>
    </div>
  )
}
