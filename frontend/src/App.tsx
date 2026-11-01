import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { InvoiceForm } from './components/InvoiceForm'
import { SettingsForm } from './components/SettingsForm'
import { requestPdf } from './lib/api'
import { clearConfig, exportConfig, importConfig, loadConfig, saveConfig } from './lib/storage'
import { validateInvoice } from './lib/validate'
import { DEFAULT_SETTINGS, defaultInvoice, type Invoice, type Settings } from './lib/types'
import { applyTheme, storedTheme, systemTheme, type Theme } from './lib/theme'
import './App.css'

const PREVIEW_DEBOUNCE_MS = 600

type Tab = 'invoice' | 'settings'

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme())
  const [tab, setTab] = useState<Tab>('invoice')
  const [mobileView, setMobileView] = useState<'form' | 'preview'>('form')
  const [initial] = useState(loadConfig)
  const [settings, setSettings] = useState<Settings>(initial?.settings ?? DEFAULT_SETTINGS)
  const [invoice, setInvoice] = useState<Invoice>(initial?.invoice ?? defaultInvoice)
  const [notice, setNotice] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const pendingUrlRef = useRef<string | null>(null)
  const lastKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!saveConfig(settings, invoice)) {
        setNotice('Speichern im Browser fehlgeschlagen (Speicher voll oder deaktiviert).')
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [settings, invoice])

  const exportJson = useCallback(() => {
    const url = URL.createObjectURL(exportConfig(settings, invoice))
    const link = document.createElement('a')
    link.href = url
    link.download = 'pdfcraft-config.json'
    link.click()
    URL.revokeObjectURL(url)
  }, [settings, invoice])

  const onImport = useCallback(async (file: File | undefined) => {
    if (!file) return
    try {
      const config = await importConfig(file)
      setSettings(config.settings)
      setInvoice(config.invoice)
      setNotice('Konfiguration importiert.')
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const reset = useCallback(() => {
    if (!window.confirm('Alle gespeicherten Einstellungen und Rechnungsdaten zurücksetzen?')) return
    clearConfig()
    setSettings(DEFAULT_SETTINGS)
    setInvoice(defaultInvoice())
    setNotice('Zurückgesetzt.')
  }, [])

  const issues = useMemo(() => validateInvoice(settings, invoice), [settings, invoice])

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
    const key = JSON.stringify({ settings, invoice })
    if (key === lastKeyRef.current) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const blob = await requestPdf(settings, invoice, controller.signal)
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
  }, [settings, invoice])

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

  const download = useCallback(() => {
    if (!pdfBlob) return
    const url = URL.createObjectURL(pdfBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `rechnung-${invoice.number.replace(/[^\w.-]+/g, '_') || 'neu'}.pdf`
    link.click()
    URL.revokeObjectURL(url)
  }, [pdfBlob, invoice.number])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    if (storedTheme()) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => !storedTheme() && setTheme(systemTheme())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next, true)
    setTheme(next)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          <span className="logo">📄</span> PDFCraft
        </h1>
        <p className="app-subtitle">Rechnungs-Konfigurator</p>
        <div className="header-actions">
          <button className="btn" onClick={() => importRef.current?.click()}>Importieren</button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              void onImport(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <button className="btn" onClick={exportJson}>Exportieren</button>
          <button className="btn" onClick={reset}>Zurücksetzen</button>
          <button
            className="btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Helles Design aktivieren' : 'Dunkles Design aktivieren'}
            title={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button className="btn btn-primary" onClick={download} disabled={!pdfBlob || loading}>
            ⬇ PDF herunterladen
          </button>
        </div>
      </header>

      {notice && (
        <div className="notice" role="status" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

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
            <button className={tab === 'invoice' ? 'tab active' : 'tab'} onClick={() => setTab('invoice')}>
              Rechnung
            </button>
            <button className={tab === 'settings' ? 'tab active' : 'tab'} onClick={() => setTab('settings')}>
              Einstellungen
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
          {tab === 'invoice' ? (
            <InvoiceForm invoice={invoice} onChange={setInvoice} />
          ) : (
            <SettingsForm settings={settings} onChange={setSettings} />
          )}
        </aside>

        <main className="preview">
          {error && <div className="preview-error">Vorschau fehlgeschlagen: {error}</div>}
          {loading && <div className="preview-loading">Aktualisiere Vorschau …</div>}
          {previewUrl && <iframe className="preview-frame" title="PDF-Vorschau" src={previewUrl} />}
          {pendingUrl && (
            <iframe
              key={pendingUrl}
              className="preview-frame pending"
              title="PDF-Vorschau (wird geladen)"
              src={pendingUrl}
              onLoad={promotePending}
            />
          )}
          {!previewUrl && !pendingUrl && !error && (
            <div className="preview-empty">Vorschau wird erstellt …</div>
          )}
        </main>
      </div>
    </div>
  )
}
