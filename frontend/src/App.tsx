import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { Dashboard } from './components/Dashboard'
import { FreeVersionHint } from './components/FreeVersionHint'
import {
  DEFAULT_SETTINGS,
  defaultInvoice,
  type DocDataKind,
  type DocDrafts,
  type DocKind,
  docSpec,
  downloadBlob,
  FOLLOW_UPS,
  PaperEditor,
  exampleDataIssues,
  friendlyError,
  hasExampleSender,
  type Doc,
  type Invoice,
  requiredIssues,
  type Settings,
  tr,
  useAutosave,
  useLang,
  validateInvoice,
  zoneForField,
  ZONES,
} from '@maltinapro/pdfcraft-editor'
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
import { clearLastBackup, exportBackup, loadLastBackup, readBackup, saveLastBackup, unsavedCount } from './lib/backup'
import { clearDrafts, loadDrafts, saveDrafts } from './lib/drafts'
import { editorAdapter } from './lib/editorAdapter'
import { entryStatuses } from './lib/archiveFilter'
import { getMasterData, masterDataFromArchive, mergeMasterData, resetMasterData, setMasterData, useMasterData } from './lib/masterData'
import { handlePaymentReturn, useOffers } from './lib/purchase'
import { routeHref, useRoute } from './lib/router'
import { clearConfig, exportConfig, importConfig, loadConfig, saveConfig } from './lib/storage'
import './App.css'
import './components/pages.css'

// Every page except the dashboard is its own chunk, so the start page does not load the editor,
// the shop or the viewer (XML reader, checks, pdf.js on demand).
const BuyPage = lazy(() => import('./components/BuyPage').then((m) => ({ default: m.BuyPage })))
const DataPage = lazy(() => import('./components/DataPage').then((m) => ({ default: m.DataPage })))
const DocumentsPage = lazy(() => import('./components/DocumentsPage').then((m) => ({ default: m.DocumentsPage })))
const MasterDataPage = lazy(() => import('./components/MasterDataPage').then((m) => ({ default: m.MasterDataPage })))
const MorePage = lazy(() => import('./components/MorePage').then((m) => ({ default: m.MorePage })))
const ViewerPage = lazy(() => import('./components/ViewerPage').then((m) => ({ default: m.ViewerPage })))

const fileStem = (value: string, fallback: string) => value.replace(/[^\w.-]+/g, '_') || fallback

handlePaymentReturn()

function AppRoutes() {
  const lang = useLang() // re-render the whole tree when the UI language changes
  const route = useRoute()
  const purchases = useOffers().enabled
  const [initial] = useState(loadConfig)
  const [settings, setSettings] = useState<Settings>(initial?.settings ?? DEFAULT_SETTINGS)
  const [invoice, setInvoice] = useState<Invoice>(initial?.invoice ?? defaultInvoice)
  const [drafts, setDrafts] = useState<DocDrafts>(loadDrafts)
  const [archive, setArchive] = useState<ArchiveEntry[]>(loadArchive)
  const [notice, setNotice] = useState<string | null>(null)
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

  // Cancels a running bulk download (rate-limit waits included) when the app unmounts
  const bulkAbort = useRef<AbortController | null>(null)
  useEffect(() => () => bulkAbort.current?.abort(), [])

  const bulk = useCallback(
    async (kind: DocKind, entries: ArchiveEntry[]) => {
      // One ZIP per distinct sender/design snapshot, so every document keeps its issue-time data
      bulkAbort.current?.abort()
      const { signal } = (bulkAbort.current = new AbortController())
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
            blob = await requestBulk(kind, part.settings, documents, signal)
            break
          } catch (e) {
            if (!(e instanceof RateLimitedError) || attempt >= 3) throw e
            await new Promise<void>((resolve, reject) => {
              const wait = setTimeout(resolve, Math.min(e.retryAfter, 60) * 1000)
              signal.addEventListener('abort', () => { clearTimeout(wait); reject(e) }, { once: true })
            })
          }
        }
        downloadBlob(blob, parts.length > 1 ? `${kind}-bulk-${index + 1}.zip` : `${kind}-bulk.zip`)
      }
    },
    [settings],
  )

  const saveState = useAutosave([settings, invoice, drafts], () => {
    const ok = saveConfig(settings, invoice) && saveDrafts(drafts)
    if (!ok) {
      setNotice(tr('Speichern im Browser fehlgeschlagen (Speicher voll oder deaktiviert).', 'Saving in the browser failed (storage full or disabled).'))
    }
    return ok
  })

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
      <ViewerPage unsaved={unsaved} />
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

  const kind = spec.kind
  const isInvoice = kind === 'invoice'
  const doc = isInvoice ? invoice : drafts[kind as DocDataKind]
  return (
    <PaperEditor
      key={onSender ? 'sender' : kind}
      adapter={editorAdapter}
      kind={kind}
      initialZone={initialEditorZone}
      saveState={saveState}
      fileName={`${isInvoice ? tr('rechnung', 'invoice') : kind}-${fileStem(doc.number, tr('neu', 'new'))}`}
      settings={settings}
      onSettingsChange={setSettings}
      document={doc}
      onDocumentChange={(next) =>
        isInvoice ? setInvoice(next as Invoice) : setDrafts((current) => ({ ...current, [kind]: next as Doc }))
      }
      issues={documentIssues}
      backupHref={routeHref('data')}
      header={({ downloadButton }) => (
        <AppHeader title={spec.label} route={route} unsaved={unsaved} editor>
          {downloadButton}
        </AppHeader>
      )}
      banner={<FreeVersionHint />}
      onDownloaded={() => issue(kind)}
      renderDownloaded={(issued) => (
        <>
          <div>
            <strong>{tr('PDF erstellt und unter „Belege“ vermerkt.', 'PDF created and listed under “Documents”.')}</strong>
            <p>{tr('Die Belege liegen nur in diesem Browser.', 'Your documents are stored only in this browser.')}</p>
          </div>
          <div className="download-success-actions">
            <button type="button" className="btn btn-tonal" onClick={backup}>{tr('Sicherung herunterladen', 'Download backup')}</button>
            <a className="btn btn-tonal" href={routeHref('')}>{tr('Neues Dokument', 'New document')}</a>
            {issued
              ? FOLLOW_UPS[kind].map((next) => (
                  <button type="button" className="btn btn-tonal" key={next.to} onClick={() => followUp(issued as ArchiveEntry, next.to)}>
                    {next.label}
                  </button>
                ))
              : null}
          </div>
        </>
      )}
    />
  )
}

export default function App() {
  return (
    <Suspense fallback={null}>
      <AppRoutes />
    </Suspense>
  )
}
