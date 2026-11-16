import { API_BASE_URL } from './config'

/** What the front end reports (the backend accepts exactly these). */
export type ClientErrorKind = 'preview_render' | 'pdf_worker' | 'fetch_failed' | 'chunk_load'

const reported = new Set<ClientErrorKind>()

/**
 * Counts a front-end failure on the server: only the kind is sent (no message, URL, stack or
 * document data), at most once per kind and page load. Failures of the report itself are ignored.
 */
export function reportClientError(kind: ClientErrorKind): void {
  if (reported.has(kind)) return
  reported.add(kind)
  try {
    void fetch(`${API_BASE_URL}/v1/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
      credentials: 'include',
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    // reporting must never break the app
  }
}

/** Kind of a pdf.js failure: problems with the worker are reported separately from render errors. */
export function pdfErrorKind(error: unknown): ClientErrorKind {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /worker/i.test(text) ? 'pdf_worker' : 'preview_render'
}

const CHUNK_ERROR = /dynamically imported module|importing a module script failed|error loading dynamically imported module|Loading chunk/i

/** Reports failed lazy chunks (e.g. after a deployment replaced the files). */
export function listenForChunkErrors(): void {
  window.addEventListener('vite:preloadError', () => reportClientError('chunk_load'))
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason
    if (CHUNK_ERROR.test(reason instanceof Error ? reason.message : String(reason))) reportClientError('chunk_load')
  })
}
