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

async function errorMessage(response: Response): Promise<string> {
  let details = `HTTP ${response.status}`
  try {
    const payload = (await response.json()) as { error?: string; details?: string }
    details = [payload.error, payload.details].filter(Boolean).join(': ') || details
  } catch {
    // keep the status text
  }
  return details
}

let pendingToken: Promise<string> | null = null

/** Requests a free token; the browser needs the Anubis cookie from the challenge on /app. */
function fetchFreeToken(): Promise<string> {
  pendingToken ??= (async () => {
    const response = await fetch(`${API_BASE_URL}/v1/free-token`, {
      method: 'POST',
      credentials: 'include',
    })
    if (response.status === 403 || response.status === 409) {
      throw new Error(
        'Kostenloses Token nicht verfügbar. Bitte die Seite neu laden und die Browser-Prüfung (Anubis) lösen.',
      )
    }
    if (!response.ok) throw new Error(await errorMessage(response))
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

async function post(token: string, body: string, signal?: AbortSignal): Promise<Response> {
  return fetch(`${API_BASE_URL}/v1/invoices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body,
    signal,
  })
}

/** Renders the invoice with `POST /v1/invoices` and a free token (fetched on demand). */
export async function requestPdf(
  settings: Settings,
  invoice: Invoice,
  signal?: AbortSignal,
): Promise<Blob> {
  const body = JSON.stringify({ settings, invoice })
  let response = await post(loadToken() ?? (await fetchFreeToken()), body, signal)

  if (response.status === 401 && !DEV_TOKEN) {
    clearToken()
    response = await post(await fetchFreeToken(), body, signal)
  }

  if (response.status === 429) {
    const wait = response.headers.get('Retry-After')
    throw new Error(`Zu viele Anfragen${wait ? `, bitte ${wait} s warten` : ''}.`)
  }
  if (!response.ok) throw new Error(await errorMessage(response))
  return response.blob()
}
