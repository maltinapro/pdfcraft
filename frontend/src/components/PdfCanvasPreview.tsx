import { useEffect, useRef, useState } from 'react'
// Legacy build: it carries polyfills for the newest JavaScript APIs the modern build relies on, which older
// Chrome/Android WebView versions (and in-app browsers) lack; without them the preview stayed blank
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { tr } from '../lib/i18n'
import { canvasScale } from '../lib/pdfSupport'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// One worker for all preview updates; otherwise every update starts a new worker that parses the 1.3 MB
// pdf.js worker script again, which costs memory and time on phones
let sharedWorker: InstanceType<typeof pdfjs.PDFWorker> | null = null
const previewWorker = () => {
  if (!sharedWorker || sharedWorker.destroyed) sharedWorker = new pdfjs.PDFWorker()
  return sharedWorker
}

export function PdfCanvasPreview({ blob, onReady }: { blob: Blob; onReady?: () => void }) {
  const container = useRef<HTMLDivElement>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setFailedUrl(null)
    let task: ReturnType<typeof pdfjs.getDocument> | null = null
    void (async () => {
      task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), worker: previewWorker() })
      const doc = await task.promise
      const host = container.current
      if (cancelled || !host) return
      const width = host.clientWidth || window.innerWidth
      const canvases: HTMLCanvasElement[] = []
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: canvasScale(width, window.devicePixelRatio || 1, base.width, base.height) })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = '100%'
        await page.render({ canvas, viewport }).promise
        if (cancelled) return
        canvases.push(canvas)
      }
      host.replaceChildren(...canvases)
      onReady?.()
    })()
      .catch((e: unknown) => {
        if (cancelled) return
        console.error('PDF preview failed', e)
        container.current?.replaceChildren()
        setFailedUrl(URL.createObjectURL(blob))
      })
      .finally(() => void task?.destroy())
    return () => {
      cancelled = true
    }
  }, [blob, onReady])

  useEffect(() => () => void (failedUrl && URL.revokeObjectURL(failedUrl)), [failedUrl])

  return (
    <>
      <div ref={container} className="preview-canvas" />
      {failedUrl && (
        <div className="preview-error" role="alert">
          <strong>{tr('Die Vorschau kann in diesem Browser nicht angezeigt werden.', 'This browser cannot show the preview.')}</strong>{' '}
          <a href={failedUrl} target="_blank" rel="noopener">
            {tr('PDF öffnen', 'Open PDF')}
          </a>
        </div>
      )}
    </>
  )
}
