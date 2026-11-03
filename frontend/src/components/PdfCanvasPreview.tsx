import { useEffect, useRef } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// Browsers without a built-in PDF viewer (e.g. Chrome on Android) cannot show PDFs in an iframe
export const inlinePdfSupported = (): boolean => navigator.pdfViewerEnabled !== false

export function PdfCanvasPreview({ blob, onReady }: { blob: Blob; onReady?: () => void }) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const task = (async () => {
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
      const host = container.current
      if (cancelled || !host) return
      const width = host.clientWidth || window.innerWidth
      const ratio = window.devicePixelRatio || 1
      const canvases: HTMLCanvasElement[] = []
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: (width / base.width) * ratio })
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
    })().catch(() => undefined)
    return () => {
      cancelled = true
      void task
    }
  }, [blob, onReady])

  return <div ref={container} className="preview-canvas" />
}
