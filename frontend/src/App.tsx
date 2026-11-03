import { useCallback, useEffect, useMemo, useState } from 'react'
import { Dashboard } from './components/Dashboard'
import { DocumentForm } from './components/DocumentForm'
import { InvoiceForm } from './components/InvoiceForm'
import { Workspace } from './components/Workspace'
import { requestDocument, requestPdf } from './lib/api'
import {
  clearDrafts,
  docSpec,
  loadDrafts,
  saveDrafts,
  type DocDataKind,
  type DocDrafts,
} from './lib/documents'
import { useRoute } from './lib/router'
import { clearConfig, exportConfig, importConfig, loadConfig, saveConfig } from './lib/storage'
import { validateInvoice } from './lib/validate'
import { DEFAULT_SETTINGS, defaultInvoice, type Invoice, type Settings } from './lib/types'
import './App.css'

const fileStem = (value: string, fallback: string) => value.replace(/[^\w.-]+/g, '_') || fallback

export default function App() {
  const route = useRoute()
  const [initial] = useState(loadConfig)
  const [settings, setSettings] = useState<Settings>(initial?.settings ?? DEFAULT_SETTINGS)
  const [invoice, setInvoice] = useState<Invoice>(initial?.invoice ?? defaultInvoice)
  const [drafts, setDrafts] = useState<DocDrafts>(loadDrafts)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!saveConfig(settings, invoice) || !saveDrafts(drafts)) {
        setNotice('Speichern im Browser fehlgeschlagen (Speicher voll oder deaktiviert).')
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [settings, invoice, drafts])

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
    if (!window.confirm('Alle gespeicherten Einstellungen und Dokumentdaten zurücksetzen?')) return
    clearConfig()
    clearDrafts()
    setSettings(DEFAULT_SETTINGS)
    setInvoice(defaultInvoice())
    setDrafts(loadDrafts())
    setNotice('Zurückgesetzt.')
  }, [])

  const issues = useMemo(() => validateInvoice(settings, invoice), [settings, invoice])
  const spec = docSpec(route)

  if (!spec) {
    return (
      <Dashboard
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        onImport={(file) => void onImport(file)}
        onExport={exportJson}
        onReset={reset}
      />
    )
  }

  if (spec.kind === 'invoice') {
    return (
      <Workspace
        key="invoice"
        title={spec.label}
        tabLabel="Rechnung"
        fileName={`rechnung-${fileStem(invoice.number, 'neu')}`}
        settings={settings}
        onSettingsChange={setSettings}
        forInvoice
        data={{ settings, invoice }}
        render={(signal) => requestPdf(settings, invoice, signal)}
        form={<InvoiceForm invoice={invoice} onChange={setInvoice} />}
        issues={issues}
      />
    )
  }

  const kind = spec.kind as DocDataKind
  const doc = drafts[kind]
  return (
    <Workspace
      key={kind}
      title={spec.label}
      tabLabel={spec.label}
      fileName={`${kind}-${fileStem(doc.number, 'neu')}`}
      settings={settings}
      onSettingsChange={setSettings}
      forInvoice={false}
      data={{ kind, settings, doc }}
      render={(signal) => requestDocument(kind, settings, doc, signal)}
      form={
        <DocumentForm
          spec={spec}
          doc={doc}
          onChange={(next) => setDrafts((current) => ({ ...current, [kind]: next }))}
        />
      }
    />
  )
}
