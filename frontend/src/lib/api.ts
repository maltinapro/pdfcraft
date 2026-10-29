import type { PdfRequest } from './buildRequest'

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ??
  'http://localhost:3000'

export async function requestPdf(body: PdfRequest, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/generate-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    let details = `HTTP ${response.status}`
    try {
      const payload = (await response.json()) as { error?: string; details?: string }
      details = [payload.error, payload.details].filter(Boolean).join(': ') || details
    } catch {
      // keep the status text
    }
    throw new Error(details)
  }

  return response.blob()
}
