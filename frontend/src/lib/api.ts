import { friendlyApiError, parseValidationDetails, type ServerIssue } from './apiErrors'
import { tr } from './i18n'
import type { Doc, DocKind } from './documents'
import type { Invoice, PostageStamp, Settings } from './types'

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ??
  'http://localhost:3000'

// Development shortcut: a token created with `pdfcraft-backend tokens create-free`
const DEV_TOKEN = import.meta.env.VITE_API_TOKEN as string | undefined

const TOKEN_KEY = 'pdfcraft.freeToken'

interface StoredToken {
  token: string
  expiresAt: number
}

const PAID_TOKEN_KEY = 'pdfcraft.paidToken'

/** A purchased token (`pk_…`); it is used instead of the free token while it is valid. */
export interface PaidToken {
  token: string
  expiresAt: number
  plan: string
  limitPerMinute: number
}

export function loadPaidToken(): PaidToken | null {
  try {
    const raw = localStorage.getItem(PAID_TOKEN_KEY)
    const stored = raw ? (JSON.parse(raw) as PaidToken) : null
    return stored && typeof stored.token === 'string' && stored.token.startsWith('pk_') ? stored : null
  } catch {
    return null
  }
}

export function savePaidToken(token: PaidToken | null) {
  try {
    if (token) localStorage.setItem(PAID_TOKEN_KEY, JSON.stringify(token))
    else localStorage.removeItem(PAID_TOKEN_KEY)
  } catch {
    // storage unavailable
  }
}

// Set when the server rejected the purchased token (revoked or expired early): use the free token
let paidRejected = false

function activePaidToken(): string | null {
  const paid = paidRejected ? null : loadPaidToken()
  return paid && paid.expiresAt * 1000 > Date.now() + 5000 ? paid.token : null
}

/** True while a purchased token that has not expired is stored (then PDFs carry no watermark). */
export function hasActivePaidToken(): boolean {
  return activePaidToken() !== null
}

function loadToken(): string | null {
  if (DEV_TOKEN) return DEV_TOKEN
  const paid = activePaidToken()
  if (paid) return paid
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

/** Error of the backend with its stable error code (`postage_disabled`, `validation_error`, …). */
export class ApiError extends Error {
  readonly code: string | undefined
  readonly details: string | undefined

  constructor(message: string, code?: string, details?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.details = details
  }
}

export async function apiError(response: Response, kind: string): Promise<Error> {
  let payload: { error?: string; details?: string } = {}
  try {
    payload = (await response.json()) as typeof payload
  } catch {
    // no JSON body, the status code is enough
  }
  const message = friendlyApiError(response.status, payload.error, payload.details, kind)
  return payload.error === 'validation_error'
    ? new ValidationError(message, parseValidationDetails(payload.details ?? ''))
    : new ApiError(message, payload.error, payload.details)
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

async function send(method: string, path: string, token: string, body?: string, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${token}` },
      body,
      signal,
    })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new Error(tr('Der Server ist nicht erreichbar. Bitte Internetverbindung prüfen.', 'The server cannot be reached. Please check your connection.'))
  }
}

/** The rate limit was hit; `retryAfter` is the wait in seconds that the server suggests. */
export class RateLimitedError extends Error {
  constructor(message: string, readonly retryAfter: number) {
    super(message)
  }
}

/** Calls the API with a free token (fetched on demand, renewed once on 401); returns the successful response. */
async function request(method: string, path: string, payload?: unknown, signal?: AbortSignal): Promise<Response> {
  const body = payload === undefined ? undefined : JSON.stringify(payload)
  let response = await send(method, path, loadToken() ?? (await fetchFreeToken()), body, signal)

  if (response.status === 401 && !DEV_TOKEN) {
    if (activePaidToken()) paidRejected = true
    clearToken()
    response = await send(method, path, await fetchFreeToken(), body, signal)
  }

  if (response.status === 429) {
    const wait = response.headers.get('Retry-After')
    throw new RateLimitedError(
      tr(`Zu viele Anfragen${wait ? `, bitte ${wait} s warten` : ''}.`, `Too many requests${wait ? `, please wait ${wait} s` : ''}.`),
      Number(wait) || 10,
    )
  }
  if (!response.ok) throw await apiError(response, (payload as { type?: string } | undefined)?.type ?? 'invoice')
  return response
}

const requestBlob = async (path: string, payload: unknown, signal?: AbortSignal): Promise<Blob> =>
  (await request('POST', path, payload, signal)).blob()

/** Calls an endpoint with the purchased token only (no fallback to a free token). */
export async function requestWithPaidToken<T>(method: 'GET' | 'POST', path: string, token: string): Promise<T> {
  const response = await send(method, path, token)
  if (!response.ok) throw await apiError(response, 'invoice')
  return response.json() as Promise<T>
}

/** Forget that the purchased token was rejected (after a purchase or renewal). */
export function resetPaidRejection() {
  paidRejected = false
}

/** JSON call for endpoints that do not return a PDF (`/v1/postage/*`). */
export async function requestJson<T>(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<T> {
  return (await request(method, path, payload)).json() as Promise<T>
}

/** Only the stamp image goes to the backend; the purchase details stay in the browser. */
function forBackend<T extends { postage?: PostageStamp | null }>(document: T) {
  const { postage, ...rest } = document
  return postage ? { ...rest, postage: { base64: postage.base64 } } : rest
}

/** Renders the invoice with `POST /v1/invoices`. */
export function requestPdf(settings: Settings, invoice: Invoice, signal?: AbortSignal): Promise<Blob> {
  return requestBlob('/v1/invoices', { settings, invoice: forBackend(invoice) }, signal)
}

/** Renders a credit note, offer, order confirmation, delivery note or letter with `POST /v1/documents`. */
export function requestDocument(
  kind: DocKind,
  settings: Settings,
  document: Doc,
  signal?: AbortSignal,
): Promise<Blob> {
  return requestBlob('/v1/documents', { type: kind, settings, document: forBackend(document) }, signal)
}

/** Documents per bulk request that the active token's plan allows (small fallback if the server cannot say). */
export async function fetchBulkMax(): Promise<number> {
  try {
    const info = await requestJson<{ bulkMax?: number }>('GET', '/v1/token')
    return info.bulkMax && info.bulkMax > 0 ? info.bulkMax : 5
  } catch {
    return 5
  }
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
