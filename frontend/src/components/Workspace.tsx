import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppHeader } from './AppHeader'
import { PdfCanvasPreview, inlinePdfSupported } from './PdfCanvasPreview'
import { FormIssuesContext, type FormIssuesValue } from './FormIssues'
import { SettingsForm } from './SettingsForm'
import { ThemeToggle } from './ThemeToggle'
import { ValidationError } from '../lib/api'
import { fieldTitle } from '../lib/apiErrors'
import { tr, useLang } from '../lib/i18n'
import { routeHref } from '../lib/router'
import type { Issue } from '../lib/validate'
import type { Settings } from '../lib/types'

const PREVIEW_DEBOUNCE_MS = 600

interface Props {
  title: string
  /** Document type (`DocKind`), used to name form fields in messages. */
  kind: string
  /** Download file name without extension. */
  fileName: string
  settings: Settings
  onSettingsChange: (settings: Settings) => void
  /** Bank details and e-invoice options are only shown for invoices. */
  forInvoice: boolean
  /** Everything that influences the PDF; the preview is re-rendered when it changes. */
  data: unknown
  render: (signal: AbortSignal) => Promise<Blob>
  /** Form of the document itself (first tab). */
  form: ReactNode
  tabLabel: string
  /** Problems found in the form (required fields with `blocking`, e-invoice hints, duplicate number). */
  issues?: Issue[]
  /** Called after the PDF was downloaded (the document counts as issued). */
  onDownloaded?: () => void
  /** Tab shown first (`settings` when coming from the start step). */
  initialTab?: Tab
  /** Result of the automatic save in the browser. */
  saveState?: SaveState
}

type Tab = 'document' | 'settings'

export type SaveState = 'saving' | 'saved' | 'error'

function PreviewError({ message }: { message: string }) {
  return (
    <div className="preview-error" role="alert">
      <strong>{`${tr('Vorschau fehlgeschlagen', 'Preview failed')}: ${message}`}</strong>
    </div>
  )
}

/** Calm hint instead of an error banner: the details are marked in the form. */
function PreviewPaused({ count, onShow }: { count: number; onShow: () => void }) {
  return (
    <div className="preview-paused">
      <span>
        {count === 1
          ? tr('Vorschau pausiert: 1 Angabe fehlt oder ist ungültig.', 'Preview paused: 1 entry is missing or invalid.')
          : tr(`Vorschau pausiert: ${count} Angaben fehlen oder sind ungültig.`, `Preview paused: ${count} entries are missing or invalid.`)}
      </span>
      <button type="button" className="btn btn-small" onClick={onShow}>
        {tr('Anzeigen', 'Show')}
      </button>
    </div>
  )
}

interface SummaryProps {
  issues: Issue[]
  kind: string
  onJump: (field: string) => void
}

/** One list for all problems; every entry with a field jumps to the input. */
function IssueSummary({ issues, kind, onJump }: SummaryProps) {
  const errors = issues.filter((i) => i.level === 'error').length
  const title =
    errors === 0
      ? tr('Hinweise', 'Notes')
      : errors === 1
        ? tr('1 Angabe prüfen', '1 entry needs attention')
        : tr(`${errors} Angaben prüfen`, `${errors} entries need attention`)
  return (
    <section className={errors === 0 ? 'issue-summary notes-only' : 'issue-summary'} aria-label={title}>
      <strong className="issue-summary-title">{title}</strong>
      <ul>
        {issues.map((issue) => {
          const where = issue.field ? fieldTitle(issue.field, kind) : null
          const text = where ? `${where}: ${issue.message}` : issue.message
          return (
            <li key={`${issue.field ?? ''}|${issue.message}`} className={`issue issue-${issue.level}`}>
              {issue.field ? (
                <button type="button" className="issue-link" onClick={() => onJump(issue.field as string)}>
                  {text}
                </button>
              ) : (
                text
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Form + live PDF preview + download, shared by all document types. */
export function Workspace({
  title,
  kind,
  fileName,
  settings,
  onSettingsChange,
  forInvoice,
  data,
  render,
  form,
  tabLabel,
  issues = [],
  onDownloaded,
  initialTab = 'document',
  saveState = 'saved',
}: Props) {
  useLang()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [mobileView, setMobileView] = useState<'form' | 'preview'>('form')
  const [inlineSupported] = useState(inlinePdfSupported)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [serverIssues, setServerIssues] = useState<Issue[]>([])
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const pendingUrlRef = useRef<string | null>(null)
  const lastKeyRef = useRef<string | null>(null)
  const renderRef = useRef(render)
  renderRef.current = render

  const key = useMemo(() => JSON.stringify(data), [data])

  const blocking = useMemo(() => issues.some((i) => i.blocking), [issues])
  const blockingRef = useRef(blocking)
  blockingRef.current = blocking

  // Client findings win; backend findings only add fields the client did not catch
  const allIssues = useMemo(() => {
    const covered = new Set(issues.map((i) => i.field).filter(Boolean))
    const extra = serverIssues.filter((i) => !i.field || !covered.has(i.field))
    const merged = [...issues, ...extra]
    return [...merged.filter((i) => i.level === 'error'), ...merged.filter((i) => i.level !== 'error')]
  }, [issues, serverIssues])

  const revealed = useCallback(
    (issue: Issue) => showAll || !!issue.server || (!!issue.field && touched.has(issue.field)),
    [showAll, touched],
  )
  const problems = allIssues.filter((i) => i.blocking || i.server)
  const paused = problems.length > 0
  const summary = allIssues.filter((i) => (i.blocking || i.server ? revealed(i) : true))

  const touch = useCallback((field: string) => {
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)))
  }, [])

  const formIssues = useMemo<FormIssuesValue>(() => {
    const visible = new Map<string, Issue>()
    for (const issue of allIssues) {
      if (issue.field && revealed(issue) && !visible.has(issue.field)) visible.set(issue.field, issue)
    }
    return { issue: (field) => visible.get(field), touch }
  }, [allIssues, revealed, touch])

  useEffect(() => {
    if (!paused) setShowAll(false)
  }, [paused])

  const jumpTo = useCallback((field: string) => {
    setTab(field.startsWith('settings.') ? 'settings' : 'document')
    setMobileView('form')
    window.setTimeout(() => {
      const input = sidebarRef.current?.querySelector<HTMLElement>(`[data-field="${CSS.escape(field)}"]`)
      if (!input) return
      input.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      input.focus({ preventScroll: true })
    }, 0)
  }, [])

  const revealProblems = () => {
    setShowAll(true)
    const first = problems.find((i) => i.field)
    if (first?.field) jumpTo(first.field)
  }

  const errorsIn = (settingsTab: boolean) =>
    summary.filter((i) => i.level === 'error' && i.field && i.field.startsWith('settings.') === settingsTab).length

  const promotePending = useCallback(() => {
    const next = pendingUrlRef.current
    if (!next) return
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = next
    pendingUrlRef.current = null
    setPreviewUrl(next)
    setPendingUrl(null)
  }, [])

  useEffect(() => {
    if (key === lastKeyRef.current) return
    // Rendering would only be rejected by the backend; the form already marks what is missing
    if (blockingRef.current) {
      setLoading(false)
      setError(null)
      setServerIssues([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const blob = await renderRef.current(controller.signal)
        const url = URL.createObjectURL(blob)
        if (pendingUrlRef.current) URL.revokeObjectURL(pendingUrlRef.current)
        pendingUrlRef.current = url
        lastKeyRef.current = key
        setPdfBlob(blob)
        setPendingUrl(url)
        setError(null)
        setServerIssues([])
        setLoading(false)
      } catch (e) {
        if (controller.signal.aborted) return
        if (e instanceof ValidationError) {
          setError(null)
          setServerIssues(
            e.issues.map((i) => ({ level: 'error', field: i.field, message: i.message, blocking: true, server: true })),
          )
        } else {
          setError(e instanceof Error ? e.message : String(e))
        }
        setLoading(false)
      }
    }, PREVIEW_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [key])

  // Fallback in case the browser never fires `load` for the hidden PDF frame
  useEffect(() => {
    if (!pendingUrl) return
    const timer = window.setTimeout(promotePending, 2500)
    return () => window.clearTimeout(timer)
  }, [pendingUrl, promotePending])

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      if (pendingUrlRef.current) URL.revokeObjectURL(pendingUrlRef.current)
    },
    [],
  )

  const download = () => {
    if (paused) {
      revealProblems()
      return
    }
    if (!pdfBlob) return
    const url = URL.createObjectURL(pdfBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${fileName}.pdf`
    link.click()
    URL.revokeObjectURL(url)
    onDownloaded?.()
    setDownloaded(true)
  }

  return (
    <div className="app">
      <AppHeader title={title}>
        <ThemeToggle />
        <button className="btn btn-primary" onClick={download} disabled={loading || (!pdfBlob && !paused)}>
          {tr('⬇ PDF herunterladen', '⬇ Download PDF')}
        </button>
      </AppHeader>

      {downloaded && (
        <div className="notice notice-success" role="status">
          <span>
            {tr('✓ PDF heruntergeladen und unter „Meine Belege“ vermerkt. Die Belege liegen nur in diesem Browser – ', '✓ PDF downloaded and listed under “My documents”. Your documents are only stored in this browser – ')}
            <a href={routeHref('data')}>{tr('Sicherung herunterladen', 'download a backup')}</a>
          </span>
          <button type="button" className="notice-close" onClick={() => setDownloaded(false)} aria-label={tr('Schließen', 'Close')}>×</button>
        </div>
      )}

      <div className="mobile-switch" role="tablist">
        <button
          role="tab"
          aria-selected={mobileView === 'form'}
          className={mobileView === 'form' ? 'tab active' : 'tab'}
          onClick={() => setMobileView('form')}
        >
          {tr('Formular', 'Form')}
        </button>
        <button
          role="tab"
          aria-selected={mobileView === 'preview'}
          className={mobileView === 'preview' ? 'tab active' : 'tab'}
          onClick={() => setMobileView('preview')}
        >
          {tr('Vorschau', 'Preview')}
        </button>
      </div>

      <div className={`workspace view-${mobileView}`}>
        <aside className="sidebar" ref={sidebarRef}>
          <div className="tabs">
            <button className={tab === 'document' ? 'tab active' : 'tab'} onClick={() => setTab('document')}>
              {tabLabel}
              {errorsIn(false) > 0 && <span className="tab-badge" aria-label={tr('Fehler', 'Errors')}>{errorsIn(false)}</span>}
            </button>
            <button className={tab === 'settings' ? 'tab active' : 'tab'} onClick={() => setTab('settings')}>
              {tr('Absender & Design', 'Sender & design')}
              {errorsIn(true) > 0 && <span className="tab-badge" aria-label={tr('Fehler', 'Errors')}>{errorsIn(true)}</span>}
            </button>
          </div>
          {summary.length > 0 && <IssueSummary issues={summary} kind={kind} onJump={jumpTo} />}
          <FormIssuesContext.Provider value={formIssues}>
            {tab === 'document' ? (
              form
            ) : (
              <SettingsForm settings={settings} onChange={onSettingsChange} forInvoice={forInvoice} />
            )}
          </FormIssuesContext.Provider>
          <div className="save-status" data-state={saveState} role="status">
            {saveState === 'saving' && tr('Speichere …', 'Saving …')}
            {saveState === 'saved' && (
              <>
                {tr('✓ Automatisch in diesem Browser gespeichert · ', '✓ Saved automatically in this browser · ')}
                <a href={routeHref('data')}>{tr('Daten sichern', 'Back up data')}</a>
              </>
            )}
            {saveState === 'error' && (
              <>
                {tr('⚠ Speichern im Browser nicht möglich – ', '⚠ Saving in the browser is not possible – ')}
                <a href={routeHref('data')}>{tr('bitte Daten sichern', 'please back up your data')}</a>
              </>
            )}
          </div>
        </aside>

        <main className={`preview${paused ? ' is-paused' : ''}`}>
          {paused && <PreviewPaused count={problems.length} onShow={revealProblems} />}
          {!paused && error && <PreviewError message={error} />}
          {loading && <div className="preview-loading">{tr('Aktualisiere Vorschau …', 'Updating preview …')}</div>}
          {!inlineSupported && pdfBlob && <PdfCanvasPreview blob={pdfBlob} />}
          {inlineSupported && previewUrl && (
            <iframe className="preview-frame" title={tr('PDF-Vorschau', 'PDF preview')} src={previewUrl} />
          )}
          {inlineSupported && pendingUrl && (
            <iframe
              key={pendingUrl}
              className="preview-frame pending"
              title={tr('PDF-Vorschau (wird geladen)', 'PDF preview (loading)')}
              src={pendingUrl}
              onLoad={promotePending}
            />
          )}
          {!pdfBlob && !error && !paused && <div className="preview-empty">{tr('Vorschau wird erstellt …', 'Creating preview …')}</div>}
        </main>
      </div>
    </div>
  )
}
