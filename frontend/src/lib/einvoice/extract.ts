/** Largest PDF and XML file the viewer reads (everything stays in the browser; the limit protects the tab). */
export const MAX_PDF_BYTES = 20 * 1024 * 1024
export const MAX_XML_BYTES = 5 * 1024 * 1024

/** Attachment names used by ZUGFeRD, Factur-X and XRechnung PDFs (compared case-insensitively). */
export const ATTACHMENT_NAMES = ['factur-x.xml', 'zugferd-invoice.xml', 'xrechnung.xml']

export type ExtractErrorCode = 'empty' | 'too_large' | 'unsupported' | 'pdf_unreadable' | 'pdf_encrypted' | 'no_xml'

export class ExtractError extends Error {
  readonly code: ExtractErrorCode
  constructor(code: ExtractErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export interface Extracted {
  xml: string
  source: 'pdf' | 'xml'
  /** Name of the attachment the XML was read from (PDF) or of the dropped file (XML). */
  fileName: string
}

/** Part of the pdf.js API used here; lets tests pass a Node build of pdf.js. */
export interface PdfJs {
  getDocument(src: { data: Uint8Array }): {
    promise: Promise<{
      /** Attachment metadata by id; the content is fetched separately (and may already be present). */
      getAttachments(): Promise<Map<string, { filename: string; content?: Uint8Array | null }> | null>
      getAttachmentContent(id: string): Promise<Uint8Array | null>
    }>
    destroy(): Promise<void>
  }
}

/** pdf.js is loaded on demand (own chunk): only someone who drops a PDF pays for it. */
export async function loadPdfJs(): Promise<PdfJs> {
  // Legacy build (polyfilled) like the preview: the modern build needs very recent browsers
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs as unknown as PdfJs
}

const startsWith = (bytes: Uint8Array, text: string, from = 0) => [...text].every((ch, i) => bytes[from + i] === ch.charCodeAt(0))

const isPdf = (bytes: Uint8Array): boolean => {
  const head = Math.min(bytes.length, 1024) - 4
  for (let i = 0; i <= head; i++) if (startsWith(bytes, '%PDF', i)) return true
  return false
}

const isXml = (bytes: Uint8Array): boolean => {
  let i = startsWith(bytes, '\u00ef\u00bb\u00bf') ? 3 : 0
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++
  return bytes[i] === 0x3c // '<'
}

function decodeXml(bytes: Uint8Array): string {
  // The XML declaration may name another encoding (rare for e-invoices); UTF-8 is the default
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200))
  const declared = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1]
  if (declared && !/^utf-?8$/i.test(declared)) {
    try {
      return new TextDecoder(declared).decode(bytes)
    } catch {
      // unknown label: fall back to UTF-8
    }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

/** Picks the e-invoice XML among the attachments of a PDF: known names first, then any other `.xml`. Returns its id. */
export function pickAttachment(attachments: Map<string, { filename: string }>): { id: string; name: string } | null {
  const list = [...attachments].map(([id, a]) => ({ id, name: a.filename }))
  for (const known of ATTACHMENT_NAMES) {
    const hit = list.find((a) => a.name.toLowerCase() === known)
    if (hit) return hit
  }
  return list.find((a) => a.name.toLowerCase().endsWith('.xml')) ?? null
}

/**
 * Reads the e-invoice XML from a dropped file: a PDF (ZUGFeRD/Factur-X/XRechnung attachment) or a plain XML file.
 * Everything happens in memory in the browser.
 */
export async function extractEInvoice(bytes: Uint8Array, fileName: string, pdfjs: () => Promise<PdfJs> = loadPdfJs): Promise<Extracted> {
  if (bytes.length === 0) throw new ExtractError('empty', 'The file is empty')
  if (isPdf(bytes)) {
    if (bytes.length > MAX_PDF_BYTES) throw new ExtractError('too_large', 'The PDF is too large')
    let found: { name: string; content: Uint8Array | null } | null = null
    try {
      const lib = await pdfjs()
      // pdf.js transfers the buffer to its worker: hand it a copy
      const task = lib.getDocument({ data: bytes.slice() })
      try {
        const doc = await task.promise
        const attachments = await doc.getAttachments()
        const pick = attachments && pickAttachment(attachments)
        if (pick) found = { name: pick.name, content: attachments.get(pick.id)!.content ?? (await doc.getAttachmentContent(pick.id)) }
      } finally {
        void task.destroy()
      }
    } catch (e) {
      throw new ExtractError(e instanceof Error && e.name === 'PasswordException' ? 'pdf_encrypted' : 'pdf_unreadable', e instanceof Error ? e.message : String(e))
    }
    if (!found || !found.content) throw new ExtractError('no_xml', 'The PDF has no XML attachment')
    if (found.content.length > MAX_XML_BYTES) throw new ExtractError('too_large', 'The XML attachment is too large')
    return { xml: decodeXml(found.content), source: 'pdf', fileName: found.name }
  }
  if (isXml(bytes)) {
    if (bytes.length > MAX_XML_BYTES) throw new ExtractError('too_large', 'The XML file is too large')
    return { xml: decodeXml(bytes), source: 'xml', fileName }
  }
  throw new ExtractError('unsupported', 'Neither a PDF nor an XML file')
}
