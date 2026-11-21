import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react'
import { AppHeader } from './AppHeader'
import { EInvoiceChecks, findingCount } from './EInvoiceChecks'
import { EInvoiceView } from './EInvoiceView'
import { Banner, Button, Card, SegmentedButton } from './ui'
import { runChecks } from '../lib/einvoice/check'
import { ExtractError, MAX_PDF_BYTES, extractEInvoice, type Extracted } from '../lib/einvoice/extract'
import { prettyXml } from '../lib/einvoice/format'
import { EInvoiceParseError, parseEInvoice, type InvoiceView } from '../lib/einvoice/parse'
import { tr, useLang } from '@pdfcraft/editor'
import '../viewer.css'

type Tab = 'invoice' | 'check' | 'xml'

interface Loaded {
  extracted: Extracted
  view: InvoiceView
}

const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024))

function errorText(e: unknown): string {
  if (e instanceof ExtractError) {
    switch (e.code) {
      case 'empty':
        return tr('Die Datei ist leer.', 'The file is empty.')
      case 'too_large':
        return tr(`Die Datei ist zu groß (PDF bis ${megabytes(MAX_PDF_BYTES)} MB, XML bis 5 MB).`, `The file is too large (PDF up to ${megabytes(MAX_PDF_BYTES)} MB, XML up to 5 MB).`)
      case 'unsupported':
        return tr('Das ist weder ein PDF noch eine XML-Datei.', 'This is neither a PDF nor an XML file.')
      case 'pdf_encrypted':
        return tr('Das PDF ist passwortgeschützt und kann nicht gelesen werden.', 'The PDF is password protected and cannot be read.')
      case 'pdf_unreadable':
        return tr('Das PDF konnte nicht gelesen werden.', 'The PDF could not be read.')
      case 'no_xml':
        return tr(
          'In diesem PDF steckt keine XML-Rechnung. Es ist eine normale PDF-Rechnung und keine E-Rechnung (ZUGFeRD / Factur-X / XRechnung).',
          'This PDF contains no XML invoice. It is an ordinary PDF invoice, not an e-invoice (ZUGFeRD / Factur-X / XRechnung).',
        )
    }
  }
  if (e instanceof EInvoiceParseError) {
    switch (e.code) {
      case 'zugferd1':
        return tr('ZUGFeRD 1.x wird nicht unterstützt. Gelesen werden ZUGFeRD 2 / Factur-X sowie XRechnung (CII und UBL).', 'ZUGFeRD 1.x is not supported. ZUGFeRD 2 / Factur-X and XRechnung (CII and UBL) can be read.')
      case 'unsupported_root':
        return tr('Die XML-Datei ist keine unterstützte E-Rechnung (erwartet: CII oder UBL Invoice/CreditNote).', 'The XML file is not a supported e-invoice (expected: CII or UBL Invoice/CreditNote).')
      case 'invalid_xml':
        return tr('Die XML-Datei ist nicht wohlgeformt und kann nicht gelesen werden.', 'The XML file is not well-formed and cannot be read.')
    }
  }
  return tr('Die Datei konnte nicht gelesen werden.', 'The file could not be read.')
}

/** Public tool: read a received e-invoice (ZUGFeRD / Factur-X PDF or XRechnung XML) in the browser. Nothing is uploaded. */
export function ViewerPage({ unsaved }: { unsaved: number }) {
  const lang = useLang()
  const input = useRef<HTMLInputElement>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [tab, setTab] = useState<Tab>('invoice')

  const open = useCallback(async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(null)
    setLoaded(null)
    setFileName(file.name)
    setTab('invoice')
    try {
      const extracted = await extractEInvoice(new Uint8Array(await file.arrayBuffer()), file.name)
      setLoaded({ extracted, view: parseEInvoice(extracted.xml) })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void open(e.dataTransfer.files[0])
  }

  // `lang`: the message texts depend on the UI language
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const results = useMemo(() => (loaded ? runChecks(loaded.view) : []), [loaded, lang])
  const findings = findingCount(results)
  const xml = useMemo(() => (loaded ? prettyXml(loaded.extracted.xml) : ''), [loaded])

  return (
    <div className="app app-scroll viewer-app">
      <AppHeader title={tr('E-Rechnung prüfen', 'Check e-invoice')} route="viewer" unsaved={unsaved} />

      <main className="page viewer-page">
        <h1>{tr('ZUGFeRD / XRechnung anzeigen und prüfen', 'View and check ZUGFeRD / XRechnung')}</h1>
        <p className="page-lead">
          {tr(
            'Ziehen Sie eine empfangene E-Rechnung hierher (PDF mit eingebettetem XML oder eine XML-Datei) und lesen Sie sie wie eine normale Rechnung. Die Datei wird nur in Ihrem Browser gelesen und nicht hochgeladen.',
            'Drop a received e-invoice here (a PDF with embedded XML or an XML file) and read it like an ordinary invoice. The file is only read in your browser and is not uploaded.',
          )}
        </p>

        <div
          className={`viewer-drop${dragging ? ' is-dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <p>{busy ? tr('Datei wird gelesen …', 'Reading the file …') : tr('Datei hierher ziehen oder', 'Drop a file here or')}</p>
          <Button onClick={() => input.current?.click()} disabled={busy}>
            {tr('Datei auswählen …', 'Choose a file …')}
          </Button>
          <input
            ref={input}
            type="file"
            accept=".pdf,.xml,application/pdf,text/xml,application/xml"
            hidden
            onChange={(e) => {
              void open(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <small>{tr('PDF (ZUGFeRD, Factur-X, XRechnung) oder XML (CII, UBL)', 'PDF (ZUGFeRD, Factur-X, XRechnung) or XML (CII, UBL)')}</small>
        </div>

        {error && (
          <Banner tone="error" className="viewer-error">
            <strong>{fileName}</strong>: {error}
          </Banner>
        )}

        {loaded && (
          <Card className="viewer-result" aria-label={tr('Gelesene Rechnung', 'Invoice read')}>
            <p className="viewer-source">
              {loaded.extracted.source === 'pdf'
                ? tr(`Aus dem PDF „${fileName}“ gelesen, Anhang „${loaded.extracted.fileName}“.`, `Read from the PDF "${fileName}", attachment "${loaded.extracted.fileName}".`)
                : tr(`Aus der XML-Datei „${fileName}“ gelesen.`, `Read from the XML file "${fileName}".`)}
            </p>
            <div className="viewer-tabs">
              <SegmentedButton
                label={tr('Ansicht', 'View')}
                value={tab}
                options={[
                  { value: 'invoice', label: tr('Rechnung', 'Invoice') },
                  { value: 'check', label: `${tr('Prüfung', 'Check')}${findings > 0 ? ` (${findings})` : ''}` },
                  { value: 'xml', label: 'XML' },
                ]}
                onChange={setTab}
              />
              <Button variant="text" onClick={() => window.print()}>{tr('Drucken', 'Print')}</Button>
            </div>
            {tab === 'invoice' && <EInvoiceView view={loaded.view} />}
            {tab === 'check' && <EInvoiceChecks results={results} />}
            {/* keyboard users need to scroll the XML */}
            {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
            {tab === 'xml' && <pre className="ev-xml" tabIndex={0}>{xml}</pre>}
          </Card>
        )}
      </main>
    </div>
  )
}
