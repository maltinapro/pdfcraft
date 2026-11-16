import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { BuyPage } from './components/BuyPage'
import { Dashboard } from './components/Dashboard'
import { DataPage } from './components/DataPage'
import { DocumentForm } from './components/DocumentForm'
import { DocumentsPage } from './components/DocumentsPage'
import { MasterDataPage } from './components/MasterDataPage'
import { MorePage } from './components/MorePage'
import { InvoiceForm } from './components/InvoiceForm'
import { Workspace } from './components/Workspace'
import { downloadBlob } from './lib/download'
import { RateLimitedError, fetchBulkMax, requestBulk, requestDocument, requestPdf } from './lib/api'
import {
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
  ZONES,
  zoneForField,
  type DocDataKind,
  type DocDrafts,
  type DocKind,
} from './lib/documents'
import { clearLastBackup, exportBackup, loadLastBackup, readBackup, saveLastBackup, unsavedCount } from './lib/backup'
import { friendlyError } from './lib/apiErrors'
import { entryStatuses } from './lib/archiveFilter'
import { tr, useLang } from './lib/i18n'
import { getMasterData, masterDataFromArchive, mergeMasterData, resetMasterData, setMasterData, useMasterData } from './lib/masterData'
import { handlePaymentReturn, useOffers } from './lib/purchase'
import { routeHref, useRoute } from './lib/router'
import { clearConfig, exportConfig, importConfig, loadConfig, saveConfig } from './lib/storage'
import { exampleDataIssues, hasExampleSender, requiredIssues, validateInvoice } from './lib/validate'
import { DEFAULT_SETTINGS, defaultInvoice, type Invoice, type Settings } from './lib/types'
import type { SaveState } from './components/Workspace'
import './App.css'
import './components/ui/ui.css'
import './components/pages.css'

// Public viewer for received e-invoices: own chunk (XML reader, checks, pdf.js on demand)
const ViewerPage = lazy(() => import('./components/ViewerPage').then((m) => ({ default: m.ViewerPage })))

const fileStem = (value: string, fallback: string) => value.replace(/[^\w.-]+/g, '_') || fallback

handlePaymentReturn()

export default function App() {
  const lang = useLang() // re-render the whole tree when the UI language changes
  const route = useRoute()
  const purchases = useOffers().enabled
  const [initial] = useState(loadConfig)
  const [settings, setSettings] = useState<Settings>(initial?.settings ?? DEFAULT_SETTINGS)
  const [invoice, setInvoice] = useState<Invoice>(initial?.invoice ?? defaultInvoice)
  const [drafts, setDrafts] = useState<DocDrafts>(loadDrafts)
  const [archive, setArchive] = useState<ArchiveEntry[]>(loadArchive)
  const [notice, setNotice] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [lastBackup, setLastBackup] = useState<string | null>(loadLastBackup)
  const masterData = useMasterData()

  useEffect(() => {
    if (!saveArchive(archive)) setNotice(tr('Archiv konnte nicht gespeichert werden (Speicher voll oder deaktiviert).', 'Archive could not be saved (storage full or disabled).'))
  }, [archive])

  // A downloaded document is final: remember it and continue with the next number.
  const issue = useCallback(
    (kind: DocKind) => {
      const source = kind === 'invoice' ? invoice : drafts[kind as DocDataKind]
      const entry = makeEntry(kind, source, settings)
      setArchive((current) => [entry, ...current])
      // The stamp is used up with the download: the next document needs a new one
      if (kind === 'invoice') setInvoice((i) => ({ ...i, number: incrementNumber(i.number), postage: null }))
      else
        setDrafts((d) => ({
          ...d,
          [kind]: { ...d[kind as DocDataKind], number: incrementNumber(d[kind as DocDataKind].number), postage: null },
        }))
      return entry
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

  // Renders the PDF of an issued document again from its stored snapshot (sender/design of the issue time, current logo)
  const rerender = useCallback(
    async (entry: ArchiveEntry) => {
      try {
        const snapshot = groupBySettings([entry], settings)[0].settings
        const { blob } = entry.kind === 'invoice'
          ? await requestPdf(snapshot, entry.invoice!)
          : await requestDocument(entry.kind, snapshot, entry.doc!)
        downloadBlob(blob, `${entry.kind}-${entry.number.replace(/[^\w.-]+/g, '_') || tr('neu', 'new')}.pdf`)
      } catch (e) {
        setNotice(friendlyError(e))
      }
    },
    [settings],
  )

  const bulk = useCallback(
    async (kind: DocKind, entries: ArchiveEntry[]) => {
      // One ZIP per distinct sender/design snapshot, so every document keeps its issue-time data
      const groups = groupBySettings(entries, settings)
      // The plan limits the size of one request: split into several ZIP files if needed
      const max = await fetchBulkMax()
      const parts = groups.flatMap((group) =>
        Array.from({ length: Math.ceil(group.entries.length / max) }, (_, i) => ({
          settings: group.settings,
          entries: group.entries.slice(i * max, (i + 1) * max),
        })),
      )
      for (const [index, part] of parts.entries()) {
        const documents = part.entries.map((e) => (e.invoice ?? e.doc)!)
        let blob: Blob
        // Every document costs one rate-limit unit: wait for the bucket to refill between the parts
        for (let attempt = 0; ; attempt++) {
          try {
            blob = await requestBulk(kind, part.settings, documents)
            break
          } catch (e) {
            if (!(e instanceof RateLimitedError) || attempt >= 3) throw e
            await new Promise((resolve) => setTimeout(resolve, Math.min(e.retryAfter, 60) * 1000))
          }
        }
        downloadBlob(blob, parts.length > 1 ? `${kind}-bulk-${index + 1}.zip` : `${kind}-bulk.zip`)
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
    downloadBlob(exportBackup(settings, invoice, drafts, archive, masterData), `pdfcraft-backup-${new Date().toISOString().slice(0, 10)}.json`)
    const now = new Date().toISOString()
    saveLastBackup(now)
    setLastBackup(now)
    setNotice(tr('Sicherung heruntergeladen. Bewahren Sie die Datei an einem sicheren Ort auf.', 'Backup downloaded. Keep the file in a safe place.'))
  }, [settings, invoice, drafts, archive, masterData])

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
        // Master data is merged like the documents: what is already there is kept
        const merged = content.masterData ? mergeMasterData(getMasterData(), content.masterData) : null
        if (merged) setMasterData(merged.data)
        setNotice(
          tr(`Wiederhergestellt. ${added.length} Beleg(e) ergänzt.`, `Restored. ${added.length} document(s) added.`) +
            (merged ? ' ' + tr(`${merged.addedContacts} Empfänger und ${merged.addedArticles} Artikel ergänzt.`, `${merged.addedContacts} recipient(s) and ${merged.addedArticles} article(s) added.`) : ''),
        )
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e))
      }
    },
    [archive],
  )

  const exportJson = useCallback(() => {
    downloadBlob(exportConfig(settings, invoice), 'pdfcraft-config.json')
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
        'Wirklich alles löschen? Absenderdaten, Logo, Unterschrift, Entwürfe, Stammdaten und alle Belege werden unwiderruflich aus diesem Browser entfernt. Haben Sie vorher eine Sicherung heruntergeladen?',
        'Really delete everything? Sender details, logo, signature, drafts, master data and all documents are permanently removed from this browser. Did you download a backup first?',
      ),
    )
    if (!ok) return
    clearLastBackup()
    setLastBackup(null)
    clearConfig()
    clearDrafts()
    clearArchive()
    resetMasterData()
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
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [settings, invoice, lang],
  )
  const unsaved = unsavedCount(archive, lastBackup)
  const statuses = useMemo(() => entryStatuses(archive), [archive])
  const dismiss = () => setNotice(null)

  if (route === 'documents') {
    return (
      <DocumentsPage
        notice={notice}
        onDismissNotice={dismiss}
        archive={archive}
        statuses={statuses}
        onFollowUp={followUp}
        onRerender={(entry) => void rerender(entry)}
        onBulk={bulk}
        onDeleteEntries={(ids) => setArchive((a) => a.filter((e) => !ids.includes(e.id)))}
        unsaved={unsaved}
      />
    )
  }

  if (route === 'contacts' || route === 'articles') {
    return (
      <MasterDataPage
        tab={route}
        notice={notice}
        onDismissNotice={dismiss}
        archive={archive}
        unsaved={unsaved}
        onImportArchive={() => {
          const result = mergeMasterData(getMasterData(), masterDataFromArchive(archive))
          if (result.addedContacts + result.addedArticles > 0 && !setMasterData(result.data)) {
            setNotice(tr('Speichern im Browser fehlgeschlagen (Speicher voll oder deaktiviert).', 'Saving in the browser failed (storage full or disabled).'))
            return
          }
          setNotice(
            result.addedContacts + result.addedArticles === 0
              ? tr('Keine neuen Empfänger oder Artikel in den Belegen gefunden.', 'No new recipients or articles found in the documents.')
              : tr(`${result.addedContacts} Empfänger und ${result.addedArticles} Artikel übernommen.`, `${result.addedContacts} recipient(s) and ${result.addedArticles} article(s) imported.`),
          )
        }}
      />
    )
  }

  if (route === 'buy' && purchases) return <BuyPage unsaved={unsaved} />

  if (route === 'more') return <MorePage unsaved={unsaved} />

  if (route === 'viewer') {
    return (
      <Suspense fallback={null}>
        <ViewerPage unsaved={unsaved} />
      </Suspense>
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
        statuses={statuses}
        onFollowUp={followUp}
        onRerender={(entry) => void rerender(entry)}
        unsaved={unsaved}
        companyDone={!hasExampleSender(settings)}
        lastBackup={lastBackup}
      />
    )
  }

  const documentIssues = spec.kind === 'invoice'
    ? [...invoiceIssues, ...duplicate(invoice.number, 'invoice')]
    : [...requiredIssues(spec, settings, drafts[spec.kind as DocDataKind]), ...exampleDataIssues(settings, false), ...duplicate(drafts[spec.kind as DocDataKind].number, spec.kind)]
  const initialEditorZone = onSender
    ? 'sender'
    : !initial
      ? 'sender'
      : ZONES[spec.kind].find((zone) =>
          documentIssues.some(
            (issue) => issue.field && zoneForField(spec.kind, issue.field) === zone.id && (issue.blocking || issue.level === 'warning'),
          ),
        )?.id ?? 'recipient'

  if (spec.kind === 'invoice') {
    return (
      <Workspace
        key={onSender ? 'sender' : 'invoice'}
        route={route}
        unsaved={unsaved}
        initialZone={initialEditorZone}
        saveState={saveState}
        kind="invoice"
        title={spec.label}
        fileName={`${tr('rechnung', 'invoice')}-${fileStem(invoice.number, tr('neu', 'new'))}`}
        settings={settings}
        onSettingsChange={setSettings}
        forInvoice
        data={{ settings, invoice }}
        render={(signal) => requestPdf(settings, invoice, signal)}
        form={(zone) => <InvoiceForm invoice={invoice} settings={settings} onChange={setInvoice} zone={zone} />}
        issues={documentIssues}
        onDownloaded={() => issue('invoice')}
        onFollowUp={followUp}
        onBackup={backup}
      />
    )
  }

  const kind = spec.kind as DocDataKind
  const doc = drafts[kind]
  return (
    <Workspace
      key={kind}
      route={route}
      unsaved={unsaved}
      kind={kind}
      title={spec.label}
      initialZone={initialEditorZone}
      fileName={`${kind}-${fileStem(doc.number, tr('neu', 'new'))}`}
      settings={settings}
      onSettingsChange={setSettings}
      forInvoice={false}
      issues={documentIssues}
      saveState={saveState}
      onDownloaded={() => issue(kind)}
      data={{ kind, settings, doc }}
      render={(signal) => requestDocument(kind, settings, doc, signal)}
      form={(zone) => (
        <DocumentForm
          spec={spec}
          doc={doc}
          zone={zone}
          onChange={(next) => setDrafts((current) => ({ ...current, [kind]: next }))}
        />
      )}
      onFollowUp={followUp}
      onBackup={backup}
    />
  )
}
