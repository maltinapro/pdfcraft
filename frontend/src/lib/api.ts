import { friendlyApiError, parseValidationDetails, type ServerIssue } from './apiErrors'
import { tr } from './i18n'
import type { Doc, DocKind } from './documents'
import type { Invoice, Settings } from './types'

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ??
  'http://localhost:3000'

// Development shortcut: a token created with `pdfcraft-backend tokens create-free`
const DEV_TOKEN = import.meta.env.VITE_API_TOKEN as string | undefined

const TOKEN_KEY = 'pdfcraft.freeToken'

interface StoredToken {
  token: string
  expiresAt: number
}

function loadToken(): string | null {
  if (DEV_TOKEN) return DEV_TOKEN
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as StoredToken
    // Small margin so a token does not expire during a request
    return stored.expiresAt * 1000 > Date.now() + 5000 ? stored.token : null
  } catch {
    return null
  }
}

function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // storage unavailable
  }
}

/** The backend rejected the document data; `issues` point at the faulty form fields. */
export class ValidationError extends Error {
  readonly issues: ServerIssue[]

  constructor(message: string, issues: ServerIssue[]) {
    super(message)
    this.name = 'ValidationError'
    this.issues = issues
  }
}

async function apiError(response: Response, kind: string): Promise<Error> {
  let payload: { error?: string; details?: string } = {}
  try {
    payload = (await response.json()) as typeof payload
  } catch {
    // no JSON body, the status code is enough
  }
  const message = friendlyApiError(response.status, payload.error, payload.details, kind)
  return payload.error === 'validation_error'
    ? new ValidationError(message, parseValidationDetails(payload.details ?? ''))
    : new Error(message)
}

let pendingToken: Promise<string> | null = null

/** Requests a free token; the browser needs the Anubis cookie from the challenge on /app. */
function fetchFreeToken(): Promise<string> {
  pendingToken ??= (async () => {
    const response = await fetch(`${API_BASE_URL}/v1/free-token`, {
      method: 'POST',
      credentials: 'include',
    })
    if (response.status === 403) {
      throw new Error(
        tr(
          'Keine Anubis-Prüfung gefunden (403). Bitte die Seite neu laden und die Browser-Prüfung lösen.',
          'No Anubis check found (403). Please reload the page and complete the browser check.',
        ),
      )
    }
    if (response.status === 409) {
      throw new Error(
        tr(
          'Für diese Browser-Prüfung wurde bereits ein Token ausgegeben (409). Cookie „techaro.lol-anubis-auth“ löschen oder ein privates Fenster nutzen und neu laden.',
          'A token has already been issued for this browser check (409). Delete the cookie "techaro.lol-anubis-auth" or use a private window and reload.',
        ),
      )
    }
    if (!response.ok) throw await apiError(response, 'invoice')
    const stored = (await response.json()) as StoredToken
    try {
      localStorage.setItem(TOKEN_KEY, JSON.stringify(stored))
    } catch {
      // keep working with the in-memory token only
    }
    return stored.token
  })().finally(() => {
    pendingToken = null
  })
  return pendingToken
}

async function post(path: string, token: string, body: string, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body,
      signal,
    })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new Error(tr('Der Server ist nicht erreichbar. Bitte Internetverbindung prüfen.', 'The server cannot be reached. Please check your connection.'))
  }
}

/** POSTs JSON with a free token (fetched on demand, renewed once on 401) and returns the PDF. */
async function requestBlob(path: string, payload: unknown, signal?: AbortSignal): Promise<Blob> {
  const body = JSON.stringify(payload)
  let response = await post(path, loadToken() ?? (await fetchFreeToken()), body, signal)

  if (response.status === 401 && !DEV_TOKEN) {
    clearToken()
    response = await post(path, await fetchFreeToken(), body, signal)
  }

  if (response.status === 429) {
    const wait = response.headers.get('Retry-After')
    throw new Error(
      tr(`Zu viele Anfragen${wait ? `, bitte ${wait} s warten` : ''}.`, `Too many requests${wait ? `, please wait ${wait} s` : ''}.`),
    )
  }
  if (!response.ok) throw await apiError(response, (payload as { type?: string }).type ?? 'invoice')
  return response.blob()
}

/** Renders the invoice with `POST /v1/invoices`. */
export function requestPdf(settings: Settings, invoice: Invoice, signal?: AbortSignal): Promise<Blob> {
  return requestBlob('/v1/invoices', { settings, invoice }, signal)
}

/** Renders a credit note, offer, order confirmation, delivery note or letter with `POST /v1/documents`. */
export function requestDocument(
  kind: DocKind,
  settings: Settings,
  document: Doc,
  signal?: AbortSignal,
): Promise<Blob> {
  return requestBlob('/v1/documents', { type: kind, settings, document }, signal)
}

/** Renders many documents of one type into a ZIP (`/v1/invoices/bulk` or `/v1/documents/bulk`). */
export function requestBulk(
  kind: DocKind,
  settings: Settings,
  documents: (Invoice | Doc)[],
  signal?: AbortSignal,
): Promise<Blob> {
  return kind === 'invoice'
    ? requestBlob('/v1/invoices/bulk', { settings, invoices: documents }, signal)
    : requestBlob('/v1/documents/bulk', { type: kind, settings, documents }, signal)
}
