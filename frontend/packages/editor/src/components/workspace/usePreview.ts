import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RenderedPdf } from '../../adapter'
import { friendlyError } from '../../lib/apiErrors'
import { ValidationError } from '../../lib/errors'
import type { ZoneRect } from '../../lib/documents'
import type { Issue } from '../../lib/validate'

const PREVIEW_DEBOUNCE_MS = 600

interface Options {
  data: unknown
  blocking: boolean
  render: (signal: AbortSignal) => Promise<RenderedPdf>
}

/**
 * Renders the PDF preview after a pause in editing. A new PDF is first laid out
 * in a hidden buffer (`pendingPdf`) and replaces the visible one (`pdfBlob`) once
 * it has loaded, so the preview never flickers.
 */
export function usePreview({ data, blocking, render }: Options) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [pdfZones, setPdfZones] = useState<ZoneRect[]>([])
  const [pendingPdf, setPendingPdf] = useState<RenderedPdf | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [serverIssues, setServerIssues] = useState<Issue[]>([])
  const [pageCount, setPageCount] = useState(0)
  const pendingPdfRef = useRef<RenderedPdf | null>(null)
  const lastKeyRef = useRef<string | null>(null)
  const renderRef = useRef(render)
  renderRef.current = render

  const key = useMemo(() => JSON.stringify(data), [data])
  const blockingRef = useRef(blocking)
  blockingRef.current = blocking

  const promotePending = useCallback((blob: Blob) => {
    const next = pendingPdfRef.current
    if (!next || next.blob !== blob) return
    setPdfBlob(next.blob)
    setPdfZones(next.zones)
    setPendingPdf(null)
    pendingPdfRef.current = null
    setError(null)
    setServerIssues([])
    setLoading(false)
  }, [])
  const pendingReady = useCallback(
    (count: number) => {
      setPageCount(count)
      if (pendingPdf) promotePending(pendingPdf.blob)
    },
    [pendingPdf, promotePending],
  )

  useEffect(() => {
    if (key === lastKeyRef.current) return
    if (blockingRef.current) {
      setLoading(false)
      setError(null)
      setServerIssues([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const rendered = await renderRef.current(controller.signal)
        if (controller.signal.aborted) return
        lastKeyRef.current = key
        pendingPdfRef.current = rendered
        setPendingPdf(rendered)
        if (!pdfBlob) setError(null)
      } catch (e) {
        if (controller.signal.aborted) return
        if (e instanceof ValidationError) {
          setError(null)
          setServerIssues(e.issues.map((issue) => ({ level: 'error', field: issue.field, message: issue.message, blocking: true, server: true })))
        } else {
          setError(friendlyError(e))
        }
        setLoading(false)
      }
    }, PREVIEW_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [key, pdfBlob])

  useEffect(() => {
    if (!pdfBlob) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(pdfBlob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pdfBlob])

  return { previewUrl, pdfBlob, pdfZones, pendingPdf, loading, error, setError, serverIssues, pageCount, setPageCount, pendingReady }
}
