import { useCallback, useEffect, useMemo, useState } from 'react'
import { Dashboard } from './components/Dashboard'
import { DocumentForm } from './components/DocumentForm'
import { InvoiceForm } from './components/InvoiceForm'
import { Workspace } from './components/Workspace'
import { requestBulk, requestDocument, requestPdf } from './lib/api'
import {
  cancelledNumbers,
  duplicateNumberIssue,
  clearArchive,
  followUpDraft,
  incrementNumber,
  loadArchive,
  exportArchive,
  importArchive,
  groupBySettings,
  makeEntry,
  saveArchive,
  type ArchiveEntry,
} from './lib/archive'
import {
  clearDrafts,
  docSpec,
  loadDrafts,
  saveDrafts,
  type DocDataKind,
  type DocDrafts,
  type DocKind,
} from './lib/documents'
import { tr, useLang } from './lib/i18n'
import { routeHref, useRoute } from './lib/router'
import { clearConfig, exportConfig, importConfig, loadConfig, saveConfig } from './lib/storage'
import { validateInvoice } from './lib/validate'
import { DEFAULT_SETTINGS, defaultInvoice, type Invoice, type Settings } from './lib/types'
import './App.css'

const fileStem = (value: string, fallback: string) => value.replace(/[^\w.-]+/g, '_') || fallback

export default function App() {
  useLang() // re-render the whole tree when the UI language changes
  const route = useRoute()
  const [initial] = useState(loadConfig)
  const [settings, setSettings] = useState<Settings>(initial?.settings ?? DEFAULT_SETTINGS)
  const [invoice, setInvoice] = useState<Invoice>(initial?.invoice ?? defaultInvoice)
  const [drafts, setDrafts] = useState<DocDrafts>(loadDrafts)
  const [archive, setArchive] = useState<ArchiveEntry[]>(loadArchive)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!saveArchive(archive)) setNotice(tr('Archiv konnte nicht gespeichert werden (Speicher voll oder deaktiviert).', 'Archive could not be saved (storage full or disabled).'))
  }, [archive])

  // A downloaded document is final: remember it and continue with the next number.
  const issue = useCallback(
    (kind: DocKind) => {
      const source = kind === 'invoice' ? invoice : drafts[kind as DocDataKind]
      setArchive((current) => [makeEntry(kind, source, settings), ...current])
      if (kind === 'invoice') setInvoice((i) => ({ ...i, number: incrementNumber(i.number) }))
      else
        setDrafts((d) => ({
          ...d,
          [kind]: { ...d[kind as DocDataKind], number: incrementNumber(d[kind as DocDataKind].number) },
        }))
    },
    [invoice, drafts, settings],
  )

  const followUp = useCallback(
    (entry: ArchiveEntry, target: DocKind) => {
      if (target === 'invoice') setInvoice((i) => followUpDraft(entry, 'invoice', i) as Invoice)
      else
        setDrafts((d) => ({
          ...d,
          [target]: followUpDraft(entry, target, d[target as DocDataKind]),
        }))
      window.location.hash = routeHref(target)
    },
    [],
  )

  const bulk = useCallback(
    async (kind: DocKind, entries: ArchiveEntry[]) => {
      // One ZIP per distinct sender/design snapshot, so every document keeps its issue-time data
      const groups = groupBySettings(entries, settings)
      for (const [index, group] of groups.entries()) {
        const blob = await requestBulk(kind, group.settings, group.entries.map((e) => (e.invoice ?? e.doc)!))
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = groups.length > 1 ? `${kind}-bulk-${index + 1}.zip` : `${kind}-bulk.zip`
        link.click()
        URL.revokeObjectURL(url)
      }
    },
    [settings],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!saveConfig(settings, invoice) || !saveDrafts(drafts)) {
        setNotice(tr('Speichern im Browser fehlgeschlagen (Speicher voll oder deaktiviert).', 'Saving in the browser failed (storage full or disabled).'))
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [settings, invoice, drafts])

  const downloadArchive = useCallback(() => {
    const url = URL.createObjectURL(exportArchive(archive))
    const link = document.createElement('a')
    link.href = url
    link.download = 'pdfcraft-archive.json'
    link.click()
    URL.revokeObjectURL(url)
  }, [archive])

  const uploadArchive = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      try {
        const added = await importArchive(file, archive)
        setArchive((current) => [...current, ...added].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)))
        setNotice(tr(`${added.length} Beleg(e) importiert.`, `${added.length} document(s) imported.`))
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e))
      }
    },
    [archive],
  )

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
      setNotice(tr('Konfiguration importiert.', 'Configuration imported.'))
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const reset = useCallback(() => {
    if (!window.confirm(tr('Alle gespeicherten Einstellungen und Dokumentdaten zurücksetzen?', 'Reset all saved settings and document data?'))) return
    clearConfig()
    clearDrafts()
    clearArchive()
    setArchive([])
    setSettings(DEFAULT_SETTINGS)
    setInvoice(defaultInvoice())
    setDrafts(loadDrafts())
    setNotice(tr('Zurückgesetzt.', 'Reset.'))
  }, [])

  const duplicate = (number: string, kind: DocKind) => {
    const issue = duplicateNumberIssue(archive, kind, number)
    return issue ? [issue] : []
  }
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
        archive={archive}
        cancelled={cancelledNumbers(archive)}
        onExportArchive={downloadArchive}
        onImportArchive={(file) => void uploadArchive(file)}
        onFollowUp={followUp}
        onBulk={bulk}
        onDeleteEntries={(ids) => setArchive((a) => a.filter((e) => !ids.includes(e.id)))}
      />
    )
  }

  if (spec.kind === 'invoice') {
    return (
      <Workspace
        key="invoice"
        title={spec.label}
        tabLabel={tr('Rechnung', 'Invoice')}
        fileName={`${tr('rechnung', 'invoice')}-${fileStem(invoice.number, tr('neu', 'new'))}`}
        settings={settings}
        onSettingsChange={setSettings}
        forInvoice
        data={{ settings, invoice }}
        render={(signal) => requestPdf(settings, invoice, signal)}
        form={<InvoiceForm invoice={invoice} onChange={setInvoice} />}
        issues={[...issues, ...duplicate(invoice.number, 'invoice')]}
        onDownloaded={() => issue('invoice')}
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
      fileName={`${kind}-${fileStem(doc.number, tr('neu', 'new'))}`}
      settings={settings}
      onSettingsChange={setSettings}
      forInvoice={false}
      issues={duplicate(doc.number, kind)}
      onDownloaded={() => issue(kind)}
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
