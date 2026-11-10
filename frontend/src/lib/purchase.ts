import {
  API_BASE_URL,
  apiError,
  loadPaidToken,
  requestWithPaidToken,
  resetPaidRejection,
  savePaidToken,
  type PaidToken,
} from './api'
import { useSyncExternalStore } from 'react'
import { tr } from './i18n'

export interface Offer {
  plan: string
  days: number
  /** Decimal string with two places, e.g. `19.00` */
  amount: string
  limitPerMinute: number
}

export interface Offers {
  enabled: boolean
  currency: string
  offers: Offer[]
}

export interface TokenInfo {
  kind: 'free' | 'paid'
  id: string
  plan: string
  limitPerMinute: number
  expiresAt: number | null
  subscription: boolean
}

const PENDING_KEY = 'pdfcraft.pendingOrder'

/** A payment that was started in this browser and is not collected yet. */
export interface PendingOrder {
  order: string
  /** Renewal of a stored token: there is no new token to claim; `previousEnd` tells when it was renewed. */
  renewal: boolean
  previousEnd?: number
}

export function loadPending(): PendingOrder | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    return raw ? (JSON.parse(raw) as PendingOrder) : null
  } catch {
    return null
  }
}

export function savePending(pending: PendingOrder | null) {
  try {
    if (pending) localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
    else localStorage.removeItem(PENDING_KEY)
  } catch {
    // storage unavailable
  }
}

/** What can be bought; `enabled: false` (or an unreachable server) hides the purchase UI. */
export async function fetchOffers(): Promise<Offers> {
  try {
    const response = await fetch(`${API_BASE_URL}/v1/checkout/offers`)
    if (!response.ok) return { enabled: false, currency: 'EUR', offers: [] }
    const offers = (await response.json()) as Partial<Offers>
    return offers.enabled && offers.offers?.length
      ? { enabled: true, currency: offers.currency ?? 'EUR', offers: offers.offers }
      : { enabled: false, currency: 'EUR', offers: [] }
  } catch {
    return { enabled: false, currency: 'EUR', offers: [] }
  }
}

/** Starts a Mollie payment and returns the page to send the customer to. */
export async function startCheckout(offer: Offer, options: { subscription: boolean; renew?: PaidToken }): Promise<string> {
  const tokenId = options.renew ? /^pk_([0-9a-f]+)_/.exec(options.renew.token)?.[1] : undefined
  const response = await fetch(`${API_BASE_URL}/v1/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan: offer.plan,
      days: offer.days,
      subscription: options.subscription,
      tokenId,
      locale: tr('de', 'en'),
    }),
  })
  if (!response.ok) throw await apiError(response, 'invoice')
  const { checkoutUrl, order } = (await response.json()) as { checkoutUrl: string; order: string }
  savePending({ order, renewal: !!options.renew, previousEnd: options.renew?.expiresAt })
  return checkoutUrl
}

const claims = new Map<string, Promise<PaidToken | null>>()

/** Token of a paid new purchase; `null` while the payment has not arrived yet. A token can be claimed only once, so parallel calls share one request. */
export function claimToken(order: string): Promise<PaidToken | null> {
  const running = claims.get(order)
  if (running) return running
  const claim = (async () => {
    const response = await fetch(`${API_BASE_URL}/v1/tokens/claim?order=${encodeURIComponent(order)}`)
    if (response.status === 404) return null
    if (!response.ok) throw await apiError(response, 'invoice')
    const claimed = (await response.json()) as PaidToken
    savePaidToken(claimed)
    savePending(null)
    resetPaidRejection()
    return claimed
  })()
  claims.set(order, claim)
  void claim.then(
    () => claims.delete(order),
    () => claims.delete(order),
  )
  return claim
}

/** Current data of the stored purchased token; `null` if it is expired, revoked or none is stored. */
export async function fetchTokenInfo(): Promise<TokenInfo | null> {
  const paid = loadPaidToken()
  if (!paid) return null
  try {
    const info = await requestWithPaidToken<TokenInfo>('GET', '/v1/token', paid.token)
    if (info.expiresAt && info.expiresAt !== paid.expiresAt) savePaidToken({ ...paid, expiresAt: info.expiresAt })
    return info
  } catch {
    return null
  }
}

export async function cancelSubscription(): Promise<void> {
  const paid = loadPaidToken()
  if (!paid) return
  await requestWithPaidToken('POST', '/v1/subscription/cancel', paid.token)
}

const NO_OFFERS: Offers = { enabled: false, currency: 'EUR', offers: [] }
let offersState: Offers = NO_OFFERS
let offersRequested = false
const offerListeners = new Set<() => void>()

/** Offers of the backend, fetched once; the purchase UI appears only when they are enabled. */
export function useOffers(): Offers {
  if (!offersRequested) {
    offersRequested = true
    void fetchOffers().then((offers) => {
      offersState = offers
      offerListeners.forEach((l) => l())
    })
  }
  return useSyncExternalStore(
    (cb) => {
      offerListeners.add(cb)
      return () => offerListeners.delete(cb)
    },
    () => offersState,
  )
}

/** Coming back from Mollie (`/app/?order=…`): remember the order and open the purchase page. */
export function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search)
  const order = params.get('order')
  if (!order) return
  if (loadPending()?.order !== order) savePending({ order, renewal: false })
  params.delete('order')
  const query = params.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}#/buy`)
}
