import { useEffect, useRef, useState } from 'react'
// Legacy build includes polyfills required by older Chrome and Android WebView versions.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { pdfErrorKind, reportClientError } from '../lib/clientErrors'
import { tr } from '../lib/i18n'
import { canvasScale } from '../lib/pdfSupport'
import type { ZoneId, ZoneRect } from '../lib/documents'
import { ZoneOverlay } from './editor/ZoneOverlay'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

let sharedWorker: InstanceType<typeof pdfjs.PDFWorker> | null = null
const previewWorker = () => {
  if (!sharedWorker || sharedWorker.destroyed) sharedWorker = new pdfjs.PDFWorker()
  return sharedWorker
}

interface PageView {
  number: number
  widthMm: number
  heightMm: number
  canvas: HTMLCanvasElement
}

interface Props {
  blob: Blob
  zones: readonly ZoneRect[]
  activeZone: ZoneId
  zoom: 'fit-page' | 'fit-width'
  page: number
  onZoneSelect: (zone: ZoneId) => void
  onReady?: (pages: number) => void
}

export function PdfCanvasPreview({ blob, zones, activeZone, zoom, page, onZoneSelect, onReady }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<PageView[]>([])
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setFailedUrl(null)
    setPages([])
    let task: ReturnType<typeof pdfjs.getDocument> | null = null
    const rendered: PageView[] = []
    void (async () => {
      task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), worker: previewWorker() })
      const doc = await task.promise
      const host = container.current
      if (cancelled || !host) return
      const width = Math.max(host.clientWidth - 32, 240)
      const availableHeight = Math.max(host.clientHeight - 32, 240)
      for (let number = 1; number <= doc.numPages; number++) {
        const pdfPage = await doc.getPage(number)
        const base = pdfPage.getViewport({ scale: 1 })
        const fitWidth = width / base.width
        const scale = zoom === 'fit-page' ? Math.min(fitWidth, availableHeight / base.height) : fitWidth
        const cssWidth = base.width * scale
        const viewport = pdfPage.getViewport({
          scale: canvasScale(cssWidth, window.devicePixelRatio || 1, base.width, base.height),
        })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${cssWidth}px`
        canvas.style.height = `${base.height * scale}px`
        await pdfPage.render({ canvas, viewport }).promise
        if (cancelled) return
        rendered.push({
          number,
          widthMm: (base.width * 25.4) / 72,
          heightMm: (base.height * 25.4) / 72,
          canvas,
        })
      }
      if (cancelled) return
      setPages(rendered)
      onReady?.(doc.numPages)
    })()
      .catch((e: unknown) => {
        if (cancelled) return
        console.error('PDF preview failed', e)
        reportClientError(pdfErrorKind(e))
        setFailedUrl(URL.createObjectURL(blob))
      })
      .finally(() => void task?.destroy())
    return () => {
      cancelled = true
      // iOS Safari keeps the memory of dropped canvases until they are resized to zero
      for (const { canvas } of rendered) {
        canvas.width = 0
        canvas.height = 0
      }
    }
  }, [blob, onReady, zoom])

  useEffect(() => {
    if (page > 1) container.current?.querySelector(`[data-page="${page}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [page, pages])

  useEffect(() => () => void (failedUrl && URL.revokeObjectURL(failedUrl)), [failedUrl])

  return (
    <>
      <div ref={container} className="preview-canvas">
        {pages.map((item) => (
          <div className="preview-page" data-page={item.number} key={item.number}>
            <div className="preview-page-canvas" ref={(node) => {
              if (node && item.canvas.parentElement !== node) node.replaceChildren(item.canvas)
            }} />
            <ZoneOverlay
              page={item.number}
              widthMm={item.widthMm}
              heightMm={item.heightMm}
              zones={zones}
              active={activeZone}
              onSelect={onZoneSelect}
            />
          </div>
        ))}
      </div>
      {failedUrl && (
        <div className="preview-error" role="alert">
          <strong>{tr('Die Vorschau kann in diesem Browser nicht angezeigt werden.', 'This browser cannot show the preview.')}</strong>{' '}
          <a href={failedUrl} target="_blank" rel="noopener noreferrer">
            {tr('PDF öffnen', 'Open PDF')}
          </a>
        </div>
      )}
    </>
  )
}
