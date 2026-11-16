import { tr } from './i18n'

/** Upper bound for the time until the server starts answering (a dead connection never does). */
export const REQUEST_TIMEOUT_MS = 120_000
/** Short calls (token, offers, checkout). */
export const SHORT_TIMEOUT_MS = 20_000

/** Thrown when the server did not answer within the time limit; the caller's own abort is rethrown unchanged. */
export class RequestTimeoutError extends Error {
  constructor() {
    super(
      tr(
        'Der Server antwortet nicht (Zeitüberschreitung). Bitte später erneut versuchen.',
        'The server is not responding (timeout). Please try again later.',
      ),
    )
    this.name = 'RequestTimeoutError'
  }
}

/** `fetch` that gives up after `timeoutMs` and still honours the caller's `signal`. */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const outer = init.signal
  const onAbort = () => controller.abort()
  if (outer?.aborted) controller.abort()
  else outer?.addEventListener('abort', onAbort, { once: true })
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (timedOut && !outer?.aborted) throw new RequestTimeoutError()
    throw error
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onAbort)
  }
}
