import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react'
import { DocumentForm } from './DocumentForm'
import { InvoiceForm } from './InvoiceForm'
import { FormIssuesContext, type FormIssuesValue } from './FormIssues'
import { SettingsForm } from './SettingsForm'
import { AppIcon, SegmentedButton } from '@maltinapro/design'
import { EditorFooter } from './editor/EditorFooter'
import { Stepper, type ZoneState } from './editor/Stepper'
import { ZonePanel } from './editor/ZonePanel'
import { EditorProvider, type EditorAdapter } from '../adapter'
import { downloadBlob } from '../lib/download'
import { docSpec, ZONES, zoneForField, type Doc, type DocKind, type ZoneId } from '../lib/documents'
import { tr, useLang } from '../lib/i18n'
import type { SaveState } from '../lib/saveState'
import type { Issue } from '../lib/validate'
import type { Invoice, Settings } from '../lib/types'
import { EditorSplitter, SPLIT_MAX, SPLIT_MIN } from './workspace/EditorSplitter'
import { IssueSummary, PreviewError, PreviewPaused } from './workspace/IssueSummary'
import { usePreview } from './workspace/usePreview'
import { XmlDialog } from './workspace/XmlDialog'
import { fixedZonesFor } from './workspace/zones'
import '../editor.css'

const PdfCanvasPreview = lazy(() => import('./PdfCanvasPreview').then((m) => ({ default: m.PdfCanvasPreview })))

export interface PaperEditorProps {
  /** Everything the editor needs from the host (render callback, customers, articles, …). */
  adapter: EditorAdapter
  kind: DocKind
  /** Used for the download: `<fileName>.pdf`. */
  fileName: string
  settings: Settings
  onSettingsChange: (settings: Settings) => void
  /** The document being edited: an `Invoice` for `kind === 'invoice'`, otherwise a `Doc`. */
  document: Invoice | Doc
  onDocumentChange: (document: Invoice | Doc) => void
  issues?: Issue[]
  initialZone?: ZoneId
  saveState?: SaveState
  /** Target of the "Back up" links in the footer; the links are hidden without it. */
  backupHref?: string
  /** Replaces the top bar. `downloadButton` is the "Download PDF" button (null on the last step). */
  header?: (context: { downloadButton: ReactNode }) => ReactNode
  /** Shown above the editor on wide screens (e.g. a hint). */
  banner?: ReactNode
  /** Called after the PDF was downloaded; its result is passed to `renderDownloaded`. */
  onDownloaded?: () => unknown
  /** Content of the "PDF created" panel; without it no panel is shown. */
  renderDownloaded?: (issued: unknown) => ReactNode
}

export function PaperEditor({
  adapter,
  kind,
  fileName,
  settings,
  onSettingsChange,
  document: doc,
  onDocumentChange,
  issues = [],
  initialZone = 'details',
  saveState = 'saved',
  backupHref,
  header,
  banner,
  onDownloaded,
  renderDownloaded,
}: PaperEditorProps) {
  useLang()
  const documentKind = kind
  const forInvoice = kind === 'invoice'
  const data = useMemo(() => ({ kind, settings, document: doc }), [kind, settings, doc])
  const render = useCallback((signal: AbortSignal) => adapter.render({ kind, settings, document: doc }, signal), [adapter, kind, settings, doc])
  const zones = ZONES[documentKind]
  const initialZoneState = zones.some((zone) => zone.id === initialZone) ? initialZone : zones[0].id
  const [activeZone, setActiveZone] = useState<ZoneId>(initialZoneState)
  const [senderSection, setSenderSection] = useState<'company' | 'appearance'>('company')
  const [editorSplit, setEditorSplit] = useState(38)
  const [mobileView, setMobileView] = useState<'form' | 'preview'>('form')
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 839px)').matches)
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const [visited, setVisited] = useState<ReadonlySet<ZoneId>>(() => new Set([initialZoneState]))
  const [downloaded, setDownloaded] = useState(false)
  const [issued, setIssued] = useState<unknown>(null)
  const [zoom, setZoom] = useState<'fit-page' | 'fit-width'>('fit-page')
  const [page, setPage] = useState(1)
  const [xml, setXml] = useState<string | null>(null)
  const [xmlError, setXmlError] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(initialZoneState === 'recipient' ? 1 : 0)
  const focusField = useRef<string | null>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)

  const blocking = useMemo(() => issues.some((issue) => issue.blocking), [issues])
  const { previewUrl, pdfBlob, pdfZones, pendingPdf, loading, error, setError, serverIssues, pageCount, setPageCount, pendingReady } = usePreview({ data, blocking, render })

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
  const isLastZone = activeZone === zones[zones.length - 1].id
  // Errors stay visible on every step; notes only where they can be fixed.
  const summary = allIssues.filter(
    (issue) =>
      (issue.blocking || issue.server ? revealed(issue) : true) &&
      (issue.level === 'error' || !issue.field || zoneForField(documentKind, issue.field) === activeZone),
  )

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

  const itemsLabel = documentKind === 'letter' ? zones.find((zone) => zone.id === 'items')?.label : undefined
  const activeSpec = zones.find((zone) => zone.id === activeZone) ?? zones[0]

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
          ? [...panel.querySelectorAll<HTMLElement>('[data-field]')].find((element) => element.dataset.field === field)
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
  }, [activeZone, focusRequest, mobileView])

  useEffect(() => {
    if (!paused) setShowAll(false)
  }, [paused])

  const selectZone = useCallback((zone: ZoneId) => {
    setActiveZone(zone)
    setVisited((prev) => new Set(prev).add(zone))
    setMobileView('form')
    focusField.current = null
    setFocusRequest((request) => request + 1)
  }, [])

  const jumpTo = useCallback(
    (field: string) => {
      const zone = zoneForField(documentKind, field)
      if (zone) {
        setActiveZone(zone)
        setVisited((prev) => new Set(prev).add(zone))
        if (zone === 'sender') {
          setSenderSection(
            /^(settings\.(design|accentColor|font|locale|intro|closing|footer|zugferd|einvoiceProfile|logo|signature))/.test(field)
              ? 'appearance'
              : 'company',
          )
        }
      }
      setMobileView('form')
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

  const resizeEditor = useCallback((clientX: number) => {
    const bounds = workspaceRef.current?.getBoundingClientRect()
    if (!bounds) return
    const availableWidth = Math.max(1, bounds.width - 24)
    setEditorSplit(Math.round(Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, ((clientX - bounds.left - 12) / availableWidth) * 100))))
  }, [])

  const zoneBody = (zone: ZoneId) =>
    zone === 'sender' ? (
      <>
        <SegmentedButton
          label={tr('Absender-Bereich', 'Sender section')}
          value={senderSection}
          options={[
            { value: 'company', label: tr('Firma & Bank', 'Company & bank') },
            { value: 'appearance', label: tr('Logo & Aussehen', 'Logo & look') },
          ]}
          onChange={setSenderSection}
        />
        <SettingsForm settings={settings} onChange={onSettingsChange} forInvoice={forInvoice} zone={zone} senderSection={senderSection} />
      </>
    ) : (
      forInvoice ? (
        <InvoiceForm invoice={doc as Invoice} settings={settings} onChange={onDocumentChange} zone={zone} />
      ) : (
        <DocumentForm spec={docSpec(documentKind)!} doc={doc as Doc} zone={zone} onChange={onDocumentChange} />
      )
    )

  const zonePanel = (
    <ZonePanel zone={activeSpec} total={zones.length}>
      <FormIssuesContext.Provider value={formIssues}>
        <div ref={panelRef}>{zoneBody(activeZone)}</div>
      </FormIssuesContext.Provider>
    </ZonePanel>
  )

  const swipe = useRef<{ x: number; y: number } | null>(null)
  const swipeHandlers = compact
    ? {
        onTouchStart: (event: ReactTouchEvent) => {
          const target = event.target as HTMLElement
          swipe.current = target.closest('input, select, textarea, [draggable="true"]') ? null : { x: event.touches[0].clientX, y: event.touches[0].clientY }
        },
        onTouchEnd: (event: ReactTouchEvent) => {
          const start = swipe.current
          swipe.current = null
          if (!start) return
          const dx = event.changedTouches[0].clientX - start.x
          const dy = event.changedTouches[0].clientY - start.y
          if (Math.abs(dx) > 72 && Math.abs(dx) > Math.abs(dy) * 2) changeZone(dx < 0 ? 1 : -1)
        },
      }
    : {}



  const download = () => {
    if (paused) {
      revealProblems()
      return
    }
    if (loading || !pdfBlob) {
      setError(tr('Die Vorschau wird noch erstellt. Bitte gleich erneut versuchen.', 'The preview is still being created. Please try again in a moment.'))
      return
    }
    downloadBlob(pdfBlob, `${fileName}.pdf`)
    setIssued(onDownloaded?.() ?? null)
    setDownloaded(true)
  }

  const openPdf = () => {
    if (!previewUrl) return
    window.open(previewUrl, '_blank', 'noopener,noreferrer')
  }

  const showXml = async () => {
    if (!pdfBlob || !adapter.extractXml) return
    try {
      const found = await adapter.extractXml(pdfBlob, `${fileName}.pdf`)
      if (found === null) throw new Error('no XML')
      setXml(found)
      setXmlError(null)
    } catch {
      setXml(null)
      setXmlError(tr('In diesem PDF wurde keine E-Rechnungs-XML gefunden.', 'No e-invoice XML was found in this PDF.'))
    }
  }

  const displayZones = useMemo(() => {
    const backendZones = pdfZones.filter((zone) => zone.zone === 3 || zone.zone === 4)
    return [...fixedZonesFor(settings.design), ...backendZones]
  }, [pdfZones, settings.design])

  const onPreviewZone = (zone: ZoneId) => selectZone(zone)

  const downloadButton = isLastZone ? null : (
    <button type="button" className="btn btn-primary header-download" onClick={download} aria-label={tr('PDF herunterladen', 'Download PDF')}>
      <AppIcon name="download" size={20} />
      <span className="download-label">{tr('PDF herunterladen', 'Download PDF')}</span>
    </button>
  )

  return (
    <EditorProvider adapter={adapter}>
    <div className={`app app-editor editor-zone-${activeZone}`}>
      {header?.({ downloadButton })}

      {!compact && banner}

      {downloaded && renderDownloaded && (
        <section className="download-success" role="status">
          {renderDownloaded(issued)}
          <button type="button" className="notice-close" onClick={() => setDownloaded(false)} aria-label={tr('Schließen', 'Close')}>×</button>
        </section>
      )}

      {compact && (
        <div className="editor-tabs" role="tablist" aria-label={tr('Ansicht', 'View')}>
          {(['form', 'preview'] as const).map((view) => (
            <button
              type="button"
              role="tab"
              key={view}
              aria-selected={mobileView === view}
              className={mobileView === view ? 'active' : undefined}
              onClick={() => setMobileView(view)}
            >
              {view === 'form' ? tr('Formular', 'Form') : tr('Vorschau', 'Preview')}
              {view === 'form' && problems.length > 0 && <span className="editor-tab-badge" aria-label={tr(`${problems.length} offen`, `${problems.length} open`)}>{problems.length}</span>}
            </button>
          ))}
        </div>
      )}

      <div
        className={`workspace editor-workspace editor-view-${mobileView}`}
        ref={workspaceRef}
        style={!compact ? { gridTemplateColumns: `minmax(360px, ${editorSplit}fr) 16px minmax(360px, ${100 - editorSplit}fr)` } : undefined}
      >
        {(!compact || mobileView === 'form') && (
          <aside className="sidebar editor-sidebar" ref={sidebarRef} {...swipeHandlers}>
            <Stepper zones={zones} active={activeZone} states={zoneStates} onSelect={selectZone} />
            {summary.length > 0 && <IssueSummary issues={summary} kind={kind} onJump={jumpTo} open={showAll} />}
            {zonePanel}
            <EditorFooter
              active={activeZone}
              zones={zones}
              saveState={saveState}
              backupHref={backupHref}
              onBack={() => changeZone(-1)}
              onNext={() => changeZone(1)}
              onCreate={download}
            />
          </aside>
        )}
        {!compact && (
          <EditorSplitter value={editorSplit} onChange={setEditorSplit} onDrag={resizeEditor} />
        )}

        {(!compact || mobileView === 'preview') && (
          <main className="preview editor-preview">
            <div className="preview-toolbar">
              <div className="preview-zoom" role="group" aria-label={tr('Zoom', 'Zoom')}>
                <button type="button" aria-pressed={zoom === 'fit-page'} onClick={() => setZoom('fit-page')}>{tr('Ganze Seite', 'Fit page')}</button>
                <button type="button" aria-pressed={zoom === 'fit-width'} onClick={() => setZoom('fit-width')}>{tr('Seitenbreite', 'Fit width')}</button>
              </div>
              {pageCount > 1 && (
                <div className="preview-pages">
                  <button type="button" disabled={page <= 1} onClick={() => setPage((n) => Math.max(1, n - 1))} aria-label={tr('Vorherige Seite', 'Previous page')}>‹</button>
                  <span>{tr(`Seite ${page} von ${pageCount}`, `Page ${page} of ${pageCount}`)}</span>
                  <button type="button" disabled={page >= pageCount} onClick={() => setPage((n) => Math.min(pageCount, n + 1))} aria-label={tr('Nächste Seite', 'Next page')}>›</button>
                </div>
              )}
              <span className="preview-toolbar-spacer" />
              {adapter.extractXml && settings.zugferd && (kind === 'invoice' || kind === 'credit-note') && <button type="button" className="preview-chip" onClick={() => void showXml()} disabled={!pdfBlob}>ZUGFeRD XML</button>}
              {previewUrl && <button type="button" className="preview-chip" onClick={openPdf}>{tr('PDF öffnen', 'Open PDF')}</button>}
            </div>
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
                  itemsLabel={itemsLabel}
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
                    zones={[...fixedZonesFor(settings.design), ...pendingPdf.zones.filter((zone) => zone.zone === 3 || zone.zone === 4)]}
                    activeZone={activeZone}
                    itemsLabel={itemsLabel}
                    zoom={zoom}
                    page={page}
                    onZoneSelect={onPreviewZone}
                    onReady={pendingReady}
                  />
                </div>
              </Suspense>
            )}
          </main>
        )}
      </div>

      {(xml !== null || xmlError !== null) && (
        <XmlDialog
          xml={xml}
          error={xmlError}
          onClose={() => {
            setXml(null)
            setXmlError(null)
          }}
        />
      )}
    </div>
    </EditorProvider>
  )
}
