import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppHeader } from './AppHeader'
import { FreeVersionHint } from './FreeVersionHint'
import { FormIssuesContext, type FormIssuesValue } from './FormIssues'
import { SettingsForm } from './SettingsForm'
import { EditorFooter } from './editor/EditorFooter'
import { ZoneBar, type ZoneState } from './editor/ZoneBar'
import { ZonePanel } from './editor/ZonePanel'
import { BottomSheet, Dialog, SegmentedButton } from './ui'
import { ValidationError, type RenderedPdf } from '../lib/api'
import { fieldTitle } from '../lib/apiErrors'
import { type ArchiveEntry } from '../lib/archive'
import { FOLLOW_UPS, ZONES, zoneForField, type DocKind, type ZoneId } from '../lib/documents'
import { tr, useLang } from '../lib/i18n'
import { routeHref } from '../lib/router'
import type { Issue } from '../lib/validate'
import type { Settings } from '../lib/types'
import type { ZoneRect } from '../lib/documents'
import './workspace.css'

const PdfCanvasPreview = lazy(() => import('./PdfCanvasPreview').then((m) => ({ default: m.PdfCanvasPreview })))

const PREVIEW_DEBOUNCE_MS = 600

interface Props {
  title: string
  route: string
  unsaved: number
  kind: string
  fileName: string
  settings: Settings
  onSettingsChange: (settings: Settings) => void
  forInvoice: boolean
  data: unknown
  render: (signal: AbortSignal) => Promise<RenderedPdf>
  form: (zone: ZoneId) => ReactNode
  issues?: Issue[]
  onDownloaded?: () => ArchiveEntry | void
  onFollowUp?: (entry: ArchiveEntry, target: DocKind) => void
  onBackup?: () => void
  initialZone?: ZoneId
  saveState?: SaveState
}

export type SaveState = 'saving' | 'saved' | 'error'

function PreviewError({ message }: { message: string }) {
  return (
    <div className="preview-error" role="alert">
      <strong>{`${tr('Vorschau fehlgeschlagen', 'Preview failed')}: ${message}`}</strong>
    </div>
  )
}

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
  open: boolean
}

function IssueSummary({ issues, kind, onJump, open }: SummaryProps) {
  const errors = issues.filter((issue) => issue.level === 'error').length
  const title =
    errors === 0
      ? tr('Hinweise', 'Notes')
      : errors === 1
        ? tr('1 Angabe prüfen', '1 entry needs attention')
        : tr(`${errors} Angaben prüfen`, `${errors} entries need attention`)
  return (
    <details className={errors === 0 ? 'issue-summary notes-only' : 'issue-summary'} open={open}>
      <summary className="issue-summary-title">{title}</summary>
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
    </details>
  )
}

const fixedZones: ZoneRect[] = [
  { zone: 1, page: 1, x: 25, y: 5, w: 160, h: 38 },
  { zone: 1, page: 1, x: 25, y: 250, w: 160, h: 35 },
  { zone: 2, page: 1, x: 25, y: 45, w: 85, h: 47.4 },
]

export function Workspace({
  title,
  route,
  unsaved,
  kind,
  fileName,
  settings,
  onSettingsChange,
  forInvoice,
  data,
  render,
  form,
  issues = [],
  onDownloaded,
  onFollowUp,
  onBackup,
  initialZone = 'details',
  saveState = 'saved',
}: Props) {
  useLang()
  const documentKind = kind as DocKind
  const zones = ZONES[documentKind]
  const initialZoneState = zones.some((zone) => zone.id === initialZone) ? initialZone : zones[0].id
  const [activeZone, setActiveZone] = useState<ZoneId>(initialZoneState)
  const [mobileView, setMobileView] = useState<'fields' | 'sheet'>('fields')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 839px)').matches)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [pdfZones, setPdfZones] = useState<ZoneRect[]>([])
  const [pendingPdf, setPendingPdf] = useState<RenderedPdf | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [serverIssues, setServerIssues] = useState<Issue[]>([])
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const [visited, setVisited] = useState<ReadonlySet<ZoneId>>(() => new Set([initialZoneState]))
  const [downloaded, setDownloaded] = useState(false)
  const [issuedEntry, setIssuedEntry] = useState<ArchiveEntry | null>(null)
  const [zoom, setZoom] = useState<'fit-page' | 'fit-width'>('fit-page')
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [xml, setXml] = useState<string | null>(null)
  const [xmlError, setXmlError] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(initialZoneState === 'recipient' ? 1 : 0)
  const focusField = useRef<string | null>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const pendingPdfRef = useRef<RenderedPdf | null>(null)
  const lastKeyRef = useRef<string | null>(null)
  const renderRef = useRef(render)
  renderRef.current = render

  const key = useMemo(() => JSON.stringify(data), [data])
  const blocking = useMemo(() => issues.some((issue) => issue.blocking), [issues])
  const blockingRef = useRef(blocking)
  blockingRef.current = blocking

  const allIssues = useMemo(() => {
    const covered = new Set(issues.map((issue) => issue.field).filter(Boolean))
    const extra = serverIssues.filter((issue) => !issue.field || !covered.has(issue.field))
    const merged = [...issues, ...extra]
    return [...merged.filter((issue) => issue.level === 'error'), ...merged.filter((issue) => issue.level !== 'error')]
  }, [issues, serverIssues])

  const revealed = useCallback(
    (issue: Issue) => showAll || !!issue.server || (!!issue.field && touched.has(issue.field)),
    [showAll, touched],
  )
  const problems = allIssues.filter((issue) => issue.blocking || issue.server)
  const paused = problems.length > 0
  const summary = allIssues.filter((issue) => (issue.blocking || issue.server ? revealed(issue) : true))

  const zoneStates = useMemo(() => {
    const result = {} as Record<ZoneId, ZoneState>
    for (const zone of zones) {
      const zoneIssues = allIssues.filter((issue) => issue.field && zoneForField(documentKind, issue.field) === zone.id)
      const errors = zoneIssues.filter((issue) => issue.level === 'error').length
      const warnings = zoneIssues.filter((issue) => issue.level === 'warning').length
      result[zone.id] = errors
        ? { status: 'errors', count: errors }
        : warnings
          ? { status: 'warnings', count: warnings }
          : { status: visited.has(zone.id) ? 'complete' : 'untouched' }
    }
    return result
  }, [allIssues, documentKind, visited, zones])

  const activeSpec = zones.find((zone) => zone.id === activeZone) ?? zones[0]
  const senderSummary = `${settings.sender.name} · ${settings.design === 'classic' ? tr('Klassisch', 'Classic') : 'Modern Minimal'}`

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
    const media = window.matchMedia('(max-width: 839px)')
    const update = () => setCompact(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!focusRequest) return
    const timer = window.setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      const field = focusField.current
      const target = field === ''
        ? panel.querySelector<HTMLElement>('.zone-panel-header h2')
        : field
          ? panel.querySelector<HTMLElement>(`[data-field="${CSS.escape(field)}"]`)
        : activeZone === 'recipient'
          ? panel.querySelector<HTMLElement>('.picker-actions button')
          : panel.querySelector<HTMLElement>('[data-field], input, select, textarea, button')
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
        target.focus({ preventScroll: true })
      }
      focusField.current = ''
    }, 20)
    return () => window.clearTimeout(timer)
  }, [activeZone, focusRequest, mobileView, sheetOpen])

  useEffect(() => {
    if (!paused) setShowAll(false)
  }, [paused])

  const selectZone = useCallback(
    (zone: ZoneId, openSheet = false) => {
      setActiveZone(zone)
      setVisited((prev) => new Set(prev).add(zone))
      if (openSheet) {
        setMobileView('sheet')
        setSheetOpen(true)
      } else if (compact && mobileView === 'sheet') {
        setSheetOpen(true)
      }
      focusField.current = null
      setFocusRequest((request) => request + 1)
    },
    [compact, mobileView],
  )

  const jumpTo = useCallback(
    (field: string) => {
      const zone = zoneForField(documentKind, field)
      if (zone) {
        setActiveZone(zone)
        setVisited((prev) => new Set(prev).add(zone))
      }
      setMobileView('fields')
      setSheetOpen(false)
      focusField.current = field
      setFocusRequest((request) => request + 1)
    },
    [documentKind],
  )

  const revealProblems = () => {
    setShowAll(true)
    const first = problems.find((issue) => issue.field)
    if (first?.field) jumpTo(first.field)
  }

  const changeZone = (direction: -1 | 1) => {
    const index = zones.findIndex((zone) => zone.id === activeZone)
    const next = zones[index + direction]
    if (next) selectZone(next.id)
  }

  const zoneBody = (zone: ZoneId) =>
    zone === 'sender' ? (
      <SettingsForm settings={settings} onChange={onSettingsChange} forInvoice={forInvoice} zone={zone} />
    ) : (
      form(zone)
    )

  const zonePanel = (
    <ZonePanel zone={activeSpec}>
      <FormIssuesContext.Provider value={formIssues}>
        <div ref={panelRef}>{zoneBody(activeZone)}</div>
      </FormIssuesContext.Provider>
    </ZonePanel>
  )

  const promotePending = useCallback((blob: Blob) => {
    const next = pendingPdfRef.current
    if (!next || next.blob !== blob) return
    setPdfBlob(next.blob)
    setPdfZones(next.zones)
    setPendingPdf(null)
    pendingPdfRef.current = null
    setError(null)
    setServerIssues([])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (key === lastKeyRef.current) return
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
        const rendered = await renderRef.current(controller.signal)
        if (controller.signal.aborted) return
        lastKeyRef.current = key
        pendingPdfRef.current = rendered
        setPendingPdf(rendered)
        if (!pdfBlob) setError(null)
      } catch (e) {
        if (controller.signal.aborted) return
        if (e instanceof ValidationError) {
          setError(null)
          setServerIssues(e.issues.map((issue) => ({ level: 'error', field: issue.field, message: issue.message, blocking: true, server: true })))
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
  }, [key, pdfBlob])

  useEffect(() => {
    if (!pdfBlob) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(pdfBlob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pdfBlob])

  const download = () => {
    if (paused) {
      revealProblems()
      return
    }
    if (loading || !pdfBlob) {
      setError(tr('Die Vorschau wird noch erstellt. Bitte gleich erneut versuchen.', 'The preview is still being created. Please try again in a moment.'))
      return
    }
    const url = URL.createObjectURL(pdfBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${fileName}.pdf`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    const entry = onDownloaded?.()
    setIssuedEntry(entry ?? null)
    setDownloaded(true)
  }

  const openPdf = () => {
    if (!previewUrl) return
    window.open(previewUrl, '_blank', 'noopener,noreferrer')
  }

  const showXml = async () => {
    if (!pdfBlob) return
    try {
      const { extractEInvoice } = await import('../lib/einvoice/extract')
      const found = await extractEInvoice(new Uint8Array(await pdfBlob.arrayBuffer()), `${fileName}.pdf`)
      setXml(found.xml)
      setXmlError(null)
    } catch (e) {
      setXml(null)
      setXmlError(tr('In diesem PDF wurde keine E-Rechnungs-XML gefunden.', 'No e-invoice XML was found in this PDF.'))
    }
  }

  const displayZones = useMemo(() => {
    const backendZones = pdfZones.filter((zone) => zone.zone === 3 || zone.zone === 4)
    return [...fixedZones, ...backendZones]
  }, [pdfZones])

  const onPreviewZone = (zone: ZoneId) => selectZone(zone, true)
  const summaryOpen = showAll || summary.some((issue) => issue.server)

  return (
    <div className="app app-editor">
      <AppHeader title={title} route={route} unsaved={unsaved}>
        {compact && (
          <SegmentedButton
            label={tr('Ansicht', 'View')}
            value={mobileView}
            options={[
              { value: 'fields', label: tr('Felder', 'Fields') },
              { value: 'sheet', label: tr('Blatt', 'Sheet') },
            ]}
            onChange={(view) => {
              setMobileView(view)
              setSheetOpen(false)
            }}
          />
        )}
      </AppHeader>

      <FreeVersionHint />

      {downloaded && (
        <section className="download-success" role="status">
          <div>
            <strong>{tr('PDF erstellt und unter „Belege“ vermerkt.', 'PDF created and listed under “Documents”.')}</strong>
            <p>{tr('Die Belege liegen nur in diesem Browser.', 'Your documents are stored only in this browser.')}</p>
          </div>
          <div className="download-success-actions">
            <button type="button" className="btn btn-tonal" onClick={onBackup}>{tr('Sicherung herunterladen', 'Download backup')}</button>
            <a className="btn btn-tonal" href={routeHref('')}>{tr('Neues Dokument', 'New document')}</a>
            {issuedEntry && FOLLOW_UPS[documentKind].map((followUp) => (
              <button
                type="button"
                className="btn btn-tonal"
                key={followUp.to}
                onClick={() => onFollowUp?.(issuedEntry, followUp.to)}
              >
                {followUp.label}
              </button>
            ))}
          </div>
          <button type="button" className="notice-close" onClick={() => setDownloaded(false)} aria-label={tr('Schließen', 'Close')}>×</button>
        </section>
      )}

      <div className={`workspace editor-workspace editor-view-${mobileView}`}>
        {(!compact || mobileView === 'fields') && (
          <aside className="sidebar editor-sidebar" ref={sidebarRef}>
            {!compact && <ZoneBar zones={zones} active={activeZone} states={zoneStates} onSelect={(zone) => selectZone(zone)} />}
            {activeZone !== 'sender' && zoneStates.sender.status === 'complete' && (
              <button type="button" className="sender-summary-chip" onClick={() => selectZone('sender')}>
                <span>{tr('Absender & Aussehen', 'Sender & look')}</span>
                <strong>{senderSummary} ✓</strong>
              </button>
            )}
            {summary.length > 0 && <IssueSummary issues={summary} kind={kind} onJump={jumpTo} open={summaryOpen} />}
            {zonePanel}
            {!compact && (
              <EditorFooter
                active={activeZone}
                zones={zones}
                saveState={saveState}
                onBack={() => changeZone(-1)}
                onNext={() => changeZone(1)}
                onCreate={download}
              />
            )}
          </aside>
        )}

        {(!compact || mobileView === 'sheet') && (
          <main className="preview editor-preview">
            <div className="preview-toolbar">
              <div className="preview-zoom" role="group" aria-label={tr('Zoom', 'Zoom')}>
                <button type="button" aria-pressed={zoom === 'fit-page'} onClick={() => setZoom('fit-page')}>{tr('Ganze Seite', 'Fit page')}</button>
                <button type="button" aria-pressed={zoom === 'fit-width'} onClick={() => setZoom('fit-width')}>{tr('Seitenbreite', 'Fit width')}</button>
              </div>
              <div className="preview-pages">
                <button type="button" className="btn btn-small" disabled={page <= 1} onClick={() => setPage((n) => Math.max(1, n - 1))} aria-label={tr('Vorherige Seite', 'Previous page')}>‹</button>
                <span>{tr(`Seite ${page} von ${pageCount || '…'}`, `Page ${page} of ${pageCount || '…'}`)}</span>
                <button type="button" className="btn btn-small" disabled={!pageCount || page >= pageCount} onClick={() => setPage((n) => Math.min(pageCount, n + 1))} aria-label={tr('Nächste Seite', 'Next page')}>›</button>
              </div>
              {previewUrl && <button type="button" className="btn btn-small" onClick={openPdf}>{tr('PDF öffnen', 'Open PDF')}</button>}
              {settings.zugferd && <button type="button" className="btn btn-small" onClick={() => void showXml()} disabled={!pdfBlob}>{tr('E-Rechnungs-XML', 'E-invoice XML')}</button>}
            </div>
            <BottomSheet
              open={compact && mobileView === 'sheet' && sheetOpen}
              title={activeSpec.label}
              onClose={() => setSheetOpen(false)}
            >
              <div className="editor-sheet-content">
                <ZonePanel zone={activeSpec}>
                  <FormIssuesContext.Provider value={formIssues}>
                    <div ref={panelRef}>{zoneBody(activeZone)}</div>
                  </FormIssuesContext.Provider>
                </ZonePanel>
              </div>
            </BottomSheet>
            {paused && <PreviewPaused count={problems.length} onShow={revealProblems} />}
            {!paused && error && <PreviewError message={error} />}
            {loading && <div className="preview-loading">{tr('Aktualisiere Vorschau …', 'Updating preview …')}</div>}
            {!pdfBlob && !pendingPdf && !error && !paused && <div className="preview-empty">{tr('Vorschau wird erstellt …', 'Creating preview …')}</div>}
            {pdfBlob && (
              <Suspense fallback={null}>
                <PdfCanvasPreview
                  blob={pdfBlob}
                  zones={displayZones}
                  activeZone={activeZone}
                  zoom={zoom}
                  page={page}
                  onZoneSelect={onPreviewZone}
                  onReady={setPageCount}
                />
              </Suspense>
            )}
            {pendingPdf && (
              <Suspense fallback={null}>
                <div className={`preview-buffer${pdfBlob ? ' pending' : ''}`}>
                  <PdfCanvasPreview
                    blob={pendingPdf.blob}
                    zones={[...fixedZones, ...pendingPdf.zones.filter((zone) => zone.zone === 3 || zone.zone === 4)]}
                    activeZone={activeZone}
                    zoom={zoom}
                    page={page}
                    onZoneSelect={onPreviewZone}
                    onReady={(count) => {
                      setPageCount(count)
                      promotePending(pendingPdf.blob)
                    }}
                  />
                </div>
              </Suspense>
            )}
          </main>
        )}
      </div>

      {compact && (
        <div className="editor-mobile-bar">
          <ZoneBar
            zones={zones}
            active={activeZone}
            states={zoneStates}
            compact
            onSelect={(zone) => selectZone(zone, mobileView === 'sheet')}
          />
          <EditorFooter
            active={activeZone}
            zones={zones}
            saveState={saveState}
            onBack={() => changeZone(-1)}
            onNext={() => changeZone(1)}
            onCreate={download}
          />
        </div>
      )}

      {(xml !== null || xmlError !== null) && (
        <Dialog
          open
          title={tr('E-Rechnungs-XML', 'E-invoice XML')}
          onClose={() => {
            setXml(null)
            setXmlError(null)
          }}
          className="xml-dialog"
        >
          {xmlError ? <p role="alert">{xmlError}</p> : <pre>{xml}</pre>}
          <button type="button" className="btn btn-tonal" onClick={() => { setXml(null); setXmlError(null) }}>{tr('Schließen', 'Close')}</button>
        </Dialog>
      )}
    </div>
  )
}
