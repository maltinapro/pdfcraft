import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { InvoiceForm } from './components/InvoiceForm'
import { SettingsForm } from './components/SettingsForm'
import { requestPdf } from './lib/api'
import { buildRequest } from './lib/buildRequest'
import { DEFAULT_SETTINGS, defaultInvoice, type Invoice, type Settings } from './lib/types'
import './App.css'

const PREVIEW_DEBOUNCE_MS = 600

type Tab = 'invoice' | 'settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('invoice')
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [invoice, setInvoice] = useState<Invoice>(defaultInvoice)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)

  const request = useMemo(() => buildRequest(settings, invoice), [settings, invoice])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const blob = await requestPdf(request, controller.signal)
        const url = URL.createObjectURL(blob)
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = url
        setPdfBlob(blob)
        setPreviewUrl(url)
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
  }, [request])

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    },
    [],
  )

  const download = useCallback(() => {
    if (!pdfBlob) return
    const url = URL.createObjectURL(pdfBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `rechnung-${invoice.number.replace(/[^\w.-]+/g, '_') || 'neu'}.pdf`
    link.click()
    URL.revokeObjectURL(url)
  }, [pdfBlob, invoice.number])

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          <span className="logo">📄</span> PDFCraft
        </h1>
        <p className="app-subtitle">Rechnungs-Konfigurator</p>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={download} disabled={!pdfBlob || loading}>
            ⬇ PDF herunterladen
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="tabs">
            <button className={tab === 'invoice' ? 'tab active' : 'tab'} onClick={() => setTab('invoice')}>
              Rechnung
            </button>
            <button className={tab === 'settings' ? 'tab active' : 'tab'} onClick={() => setTab('settings')}>
              Einstellungen
            </button>
          </div>
          {tab === 'invoice' ? (
            <InvoiceForm invoice={invoice} onChange={setInvoice} />
          ) : (
            <SettingsForm settings={settings} onChange={setSettings} />
          )}
        </aside>

        <main className="preview">
          {error && <div className="preview-error">Vorschau fehlgeschlagen: {error}</div>}
          {loading && <div className="preview-loading">Aktualisiere Vorschau …</div>}
          {previewUrl ? (
            <iframe className="preview-frame" title="PDF-Vorschau" src={previewUrl} />
          ) : (
            !error && <div className="preview-empty">Vorschau wird erstellt …</div>
          )}
        </main>
      </div>
    </div>
  )
}
