import { friendlyApiError, parseValidationDetails, unreachableMessage, type ServerIssue } from './apiErrors'
import { fetchWithTimeout, RequestTimeoutError, SHORT_TIMEOUT_MS } from './fetchTimeout'
import { API_BASE_URL } from './config'
import { reportClientError } from './clientErrors'
import { tr } from './i18n'
import { dunningPayload, type Doc, type DocKind, type ZoneRect } from './documents'
import type { Invoice, PostageStamp, Settings } from './types'

export { API_BASE_URL }

// Development shortcut: a token created with `pdfcraft-backend tokens create-free`
const DEV_TOKEN = import.meta.env.VITE_API_TOKEN as string | undefined

const TOKEN_KEY = 'pdfcraft.freeToken'

interface StoredToken {
  token: string
  expiresAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
    const stored: unknown = raw ? JSON.parse(raw) : null
    if (!isRecord(stored) || typeof stored.token !== 'string' || !stored.token.startsWith('pk_')) return null
    if (!Number.isFinite(stored.expiresAt) || typeof stored.plan !== 'string' || !Number.isFinite(stored.limitPerMinute)) return null
    return stored as unknown as PaidToken
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
    const stored: unknown = JSON.parse(raw)
    if (!isRecord(stored) || typeof stored.token !== 'string' || typeof stored.expiresAt !== 'number') return null
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
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/v1/free-token`,
      { method: 'POST', credentials: 'include' },
      SHORT_TIMEOUT_MS,
    ).catch((error: unknown) => {
      throw error instanceof RequestTimeoutError ? error : new Error(unreachableMessage())
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
    return await fetchWithTimeout(`${API_BASE_URL}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${token}` },
      body,
      signal,
    })
  } catch (e) {
    if (signal?.aborted) throw e
    reportClientError('fetch_failed')
    if (e instanceof RequestTimeoutError) throw e
    throw new Error(unreachableMessage())
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

export interface RenderedPdf {
  blob: Blob
  zones: ZoneRect[]
}

async function requestPreviewPdf(path: string, payload: unknown, signal?: AbortSignal): Promise<RenderedPdf> {
  const response = await request('POST', `${path}?zones=1`, payload, signal)
  let zones: ZoneRect[] = []
  try {
    const parsed: unknown = JSON.parse(response.headers.get('X-Pdfcraft-Zones') ?? '[]')
    if (Array.isArray(parsed)) {
      zones = parsed.filter(
        (zone): zone is ZoneRect =>
          typeof zone === 'object' &&
          zone !== null &&
          [1, 2, 3, 4].includes((zone as ZoneRect).zone) &&
          Number.isInteger((zone as ZoneRect).page) &&
          ['x', 'y', 'w', 'h'].every((key) => Number.isFinite((zone as unknown as Record<string, unknown>)[key])),
      )
    }
  } catch {
    // Older servers omit the optional header; the preview keeps its fixed-zone fallback.
  }
  return { blob: await response.blob(), zones }
}

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
function forBackend<T extends { postage?: PostageStamp | null; dunning?: Doc['dunning'] }>(document: T) {
  const { postage, dunning, ...rest } = document
  const body = dunning ? { ...rest, ...dunningPayload(dunning) } : rest
  return postage ? { ...body, postage: { base64: postage.base64 } } : body
}

/** Renders the invoice with `POST /v1/invoices`. */
export function requestPdf(settings: Settings, invoice: Invoice, signal?: AbortSignal): Promise<RenderedPdf> {
  return requestPreviewPdf('/v1/invoices', { settings, invoice: forBackend(invoice) }, signal)
}

/** Renders a credit note, offer, order confirmation, delivery note or letter with `POST /v1/documents`. */
export function requestDocument(
  kind: DocKind,
  settings: Settings,
  document: Doc,
  signal?: AbortSignal,
): Promise<RenderedPdf> {
  return requestPreviewPdf('/v1/documents', { type: kind, settings, document: forBackend(document) }, signal)
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
    : requestBlob('/v1/documents/bulk', { type: kind, settings, documents: documents.map((d) => ('dunning' in d && d.dunning ? forBackend(d) : d)) }, signal)
}
