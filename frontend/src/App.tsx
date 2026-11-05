import { useCallback, useEffect, useMemo, useState } from 'react'
import { Dashboard } from './components/Dashboard'
import { DataPage } from './components/DataPage'
import { DocumentForm } from './components/DocumentForm'
import { DocumentsPage } from './components/DocumentsPage'
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
import { clearLastBackup, exportBackup, loadLastBackup, readBackup, saveLastBackup, unsavedCount } from './lib/backup'
import { tr, useLang } from './lib/i18n'
import { routeHref, useRoute } from './lib/router'
import { clearConfig, exportConfig, importConfig, loadConfig, saveConfig } from './lib/storage'
import { exampleDataIssues, hasExampleSender, requiredIssues, validateInvoice } from './lib/validate'
import { DEFAULT_SETTINGS, defaultInvoice, type Invoice, type Settings } from './lib/types'
import type { SaveState } from './components/Workspace'
import './App.css'

const fileStem = (value: string, fallback: string) => value.replace(/[^\w.-]+/g, '_') || fallback

export default function App() {
  const lang = useLang() // re-render the whole tree when the UI language changes
  const route = useRoute()
  const [initial] = useState(loadConfig)
  const [settings, setSettings] = useState<Settings>(initial?.settings ?? DEFAULT_SETTINGS)
  const [invoice, setInvoice] = useState<Invoice>(initial?.invoice ?? defaultInvoice)
  const [drafts, setDrafts] = useState<DocDrafts>(loadDrafts)
  const [archive, setArchive] = useState<ArchiveEntry[]>(loadArchive)
  const [notice, setNotice] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [lastBackup, setLastBackup] = useState<string | null>(loadLastBackup)

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
    setSaveState('saving')
    const timer = window.setTimeout(() => {
      const ok = saveConfig(settings, invoice) && saveDrafts(drafts)
      setSaveState(ok ? 'saved' : 'error')
      if (!ok) {
        setNotice(tr('Speichern im Browser fehlgeschlagen (Speicher voll oder deaktiviert).', 'Saving in the browser failed (storage full or disabled).'))
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [settings, invoice, drafts])

  const backup = useCallback(() => {
    const url = URL.createObjectURL(exportBackup(settings, invoice, drafts, archive))
    const link = document.createElement('a')
    link.href = url
    link.download = `pdfcraft-backup-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    const now = new Date().toISOString()
    saveLastBackup(now)
    setLastBackup(now)
    setNotice(tr('Sicherung heruntergeladen. Bewahren Sie die Datei an einem sicheren Ort auf.', 'Backup downloaded. Keep the file in a safe place.'))
  }, [settings, invoice, drafts, archive])

  const restore = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      try {
        const content = await readBackup(file)
        if (
          content.config &&
          !window.confirm(tr('Aktuelle Absenderdaten und Entwürfe werden durch die Datei ersetzt. Fortfahren?', 'Current sender details and drafts will be replaced by the file. Continue?'))
        ) {
          return
        }
        if (content.config) {
          setSettings(content.config.settings)
          setInvoice(content.config.invoice)
        }
        if (content.drafts) setDrafts(content.drafts)
        const known = new Set(archive.map((e) => e.id))
        const added = content.archive.filter((e) => !known.has(e.id))
        setArchive((current) => [...current, ...added].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)))
        setNotice(tr(`Wiederhergestellt. ${added.length} Beleg(e) ergänzt.`, `Restored. ${added.length} document(s) added.`))
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
    const ok = window.confirm(
      tr(
        'Wirklich alles löschen? Absenderdaten, Logo, Entwürfe und alle Belege werden unwiderruflich aus diesem Browser entfernt. Haben Sie vorher eine Sicherung heruntergeladen?',
        'Really delete everything? Sender details, logo, drafts and all documents are permanently removed from this browser. Did you download a backup first?',
      ),
    )
    if (!ok) return
    clearLastBackup()
    setLastBackup(null)
    clearConfig()
    clearDrafts()
    clearArchive()
    setArchive([])
    setSettings(DEFAULT_SETTINGS)
    setInvoice(defaultInvoice())
    setDrafts(loadDrafts())
    setNotice(tr('Alle Daten wurden gelöscht.', 'All data was deleted.'))
  }, [])

  const duplicate = (number: string, kind: DocKind) => {
    const issue = duplicateNumberIssue(archive, kind, number)
    return issue ? [issue] : []
  }
  const onSender = route === 'sender'
  const spec = docSpec(onSender ? 'invoice' : route)
  const invoiceIssues = useMemo(
    () => [
      ...requiredIssues({ kind: 'invoice', items: 'priced' }, settings, invoice),
      ...validateInvoice(settings, invoice),
      ...exampleDataIssues(settings, true),
    ],
    // `lang`: the message texts depend on the UI language
    [settings, invoice, lang],
  )

  const unsaved = unsavedCount(archive, lastBackup)
  const cancelled = cancelledNumbers(archive)
  const dismiss = () => setNotice(null)

  if (route === 'documents') {
    return (
      <DocumentsPage
        notice={notice}
        onDismissNotice={dismiss}
        archive={archive}
        cancelled={cancelled}
        onFollowUp={followUp}
        onBulk={bulk}
        onDeleteEntries={(ids) => setArchive((a) => a.filter((e) => !ids.includes(e.id)))}
        unsaved={unsaved}
        onBackup={backup}
      />
    )
  }

  if (route === 'data') {
    return (
      <DataPage
        notice={notice}
        onDismissNotice={dismiss}
        lastBackup={lastBackup}
        unsaved={unsaved}
        onBackup={backup}
        onRestore={(file) => void restore(file)}
        onExportConfig={exportJson}
        onImportConfig={(file) => void onImport(file)}
        onReset={reset}
      />
    )
  }

  if (!spec) {
    return (
      <Dashboard
        notice={notice}
        onDismissNotice={dismiss}
        archive={archive}
        cancelled={cancelled}
        onFollowUp={followUp}
        unsaved={unsaved}
        onBackup={backup}
        showWelcome={hasExampleSender(settings)}
      />
    )
  }

  if (spec.kind === 'invoice') {
    return (
      <Workspace
        key={onSender ? 'sender' : 'invoice'}
        initialTab={onSender ? 'settings' : 'document'}
        saveState={saveState}
        kind="invoice"
        title={spec.label}
        tabLabel={tr('Rechnung', 'Invoice')}
        fileName={`${tr('rechnung', 'invoice')}-${fileStem(invoice.number, tr('neu', 'new'))}`}
        settings={settings}
        onSettingsChange={setSettings}
        forInvoice
        data={{ settings, invoice }}
        render={(signal) => requestPdf(settings, invoice, signal)}
        form={<InvoiceForm invoice={invoice} onChange={setInvoice} />}
        issues={[...invoiceIssues, ...duplicate(invoice.number, 'invoice')]}
        onDownloaded={() => issue('invoice')}
      />
    )
  }

  const kind = spec.kind as DocDataKind
  const doc = drafts[kind]
  return (
    <Workspace
      key={kind}
      kind={kind}
      title={spec.label}
      tabLabel={spec.label}
      fileName={`${kind}-${fileStem(doc.number, tr('neu', 'new'))}`}
      settings={settings}
      onSettingsChange={setSettings}
      forInvoice={false}
      issues={[...requiredIssues(spec, settings, doc), ...exampleDataIssues(settings, false), ...duplicate(doc.number, kind)]}
      saveState={saveState}
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
