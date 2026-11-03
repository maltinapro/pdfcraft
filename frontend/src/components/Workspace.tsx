import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppHeader } from './AppHeader'
import { PdfCanvasPreview, inlinePdfSupported } from './PdfCanvasPreview'
import { SettingsForm } from './SettingsForm'
import { ThemeToggle } from './ThemeToggle'
import type { Issue } from '../lib/validate'
import type { Settings } from '../lib/types'

const PREVIEW_DEBOUNCE_MS = 600

interface Props {
  title: string
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
  issues?: Issue[]
  /** Called after the PDF was downloaded (the document counts as issued). */
  onDownloaded?: () => void
}

type Tab = 'document' | 'settings'

/** Form + live PDF preview + download, shared by all document types. */
export function Workspace({
  title,
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
}: Props) {
  const [tab, setTab] = useState<Tab>('document')
  const [mobileView, setMobileView] = useState<'form' | 'preview'>('form')
  const [inlineSupported] = useState(inlinePdfSupported)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const pendingUrlRef = useRef<string | null>(null)
  const lastKeyRef = useRef<string | null>(null)
  const renderRef = useRef(render)
  renderRef.current = render

  const key = useMemo(() => JSON.stringify(data), [data])

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
        setLoading(false)
      } catch (e) {
        if (controller.signal.aborted) return
        setError(e instanceof Error ? e.message : String(e))
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
    if (!pdfBlob) return
    const url = URL.createObjectURL(pdfBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${fileName}.pdf`
    link.click()
    URL.revokeObjectURL(url)
    onDownloaded?.()
  }

  return (
    <div className="app">
      <AppHeader title={title}>
        <ThemeToggle />
        <button className="btn btn-primary" onClick={download} disabled={!pdfBlob || loading}>
          ⬇ PDF herunterladen
        </button>
      </AppHeader>

      <div className="mobile-switch" role="tablist">
        <button
          role="tab"
          aria-selected={mobileView === 'form'}
          className={mobileView === 'form' ? 'tab active' : 'tab'}
          onClick={() => setMobileView('form')}
        >
          Formular
        </button>
        <button
          role="tab"
          aria-selected={mobileView === 'preview'}
          className={mobileView === 'preview' ? 'tab active' : 'tab'}
          onClick={() => setMobileView('preview')}
        >
          Vorschau
        </button>
      </div>

      <div className={`workspace view-${mobileView}`}>
        <aside className="sidebar">
          <div className="tabs">
            <button className={tab === 'document' ? 'tab active' : 'tab'} onClick={() => setTab('document')}>
              {tabLabel}
            </button>
            <button className={tab === 'settings' ? 'tab active' : 'tab'} onClick={() => setTab('settings')}>
              Absender &amp; Design
            </button>
          </div>
          {issues.length > 0 && (
            <ul className="issues" aria-label="E-Rechnung Hinweise">
              {issues.map((issue) => (
                <li key={issue.message} className={`issue issue-${issue.level}`}>
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
          {tab === 'document' ? (
            form
          ) : (
            <SettingsForm settings={settings} onChange={onSettingsChange} forInvoice={forInvoice} />
          )}
        </aside>

        <main className="preview">
          {error && <div className="preview-error">Vorschau fehlgeschlagen: {error}</div>}
          {loading && <div className="preview-loading">Aktualisiere Vorschau …</div>}
          {!inlineSupported && pdfBlob && <PdfCanvasPreview blob={pdfBlob} />}
          {inlineSupported && previewUrl && (
            <iframe className="preview-frame" title="PDF-Vorschau" src={previewUrl} />
          )}
          {inlineSupported && pendingUrl && (
            <iframe
              key={pendingUrl}
              className="preview-frame pending"
              title="PDF-Vorschau (wird geladen)"
              src={pendingUrl}
              onLoad={promotePending}
            />
          )}
          {!pdfBlob && !error && <div className="preview-empty">Vorschau wird erstellt …</div>}
        </main>
      </div>
    </div>
  )
}
