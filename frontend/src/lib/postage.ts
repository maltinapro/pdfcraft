import { ApiError, requestJson } from './api'
import type { PostageStamp } from './types'

// Internetmarke (Deutsche Post): the stamp is bought with the user's own Portokasse account.
// The login is only held in the form while it is sent; it is never stored, neither here nor on the server.

export interface PostageProduct {
  productCode: number
  name: string
  priceCents: number
}

interface PurchaseResponse {
  png: string
  voucherId: string
  shopOrderId: string
  productName: string
  priceCents: number
  walletBalanceCents: number | null
}

export interface Purchase {
  stamp: PostageStamp
  walletBalanceCents: number | null
}

type Products = PostageProduct[] | 'disabled'

const CACHE_MS = 10 * 60 * 1000
let cache: { at: number; result: Promise<Products> } | null = null

/** `'disabled'` when the server does not offer stamps (then the form hides the section). */
export function loadProducts(): Promise<Products> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.result
  const result = requestJson<{ products: PostageProduct[] }>('GET', '/v1/postage/products').then(
    ({ products }): Products => products,
    (e: unknown): Products => {
      if (e instanceof ApiError && e.code === 'postage_disabled') return 'disabled'
      throw e
    },
  )
  cache = { at: Date.now(), result }
  // A failure must not be remembered: the next attempt asks again
  result.catch(() => {
    if (cache?.result === result) cache = null
  })
  return result
}

export function forgetProducts(): void {
  cache = null
}

/** Buys one stamp. A fresh `requestId` per click makes a repeated request a no-op on the server. */
export async function buyStamp(product: PostageProduct, username: string, password: string): Promise<Purchase> {
  const requestId = crypto.randomUUID()
  const response = await requestJson<PurchaseResponse>('POST', '/v1/postage/stamps', {
    productCode: product.productCode,
    expectedPriceCents: product.priceCents,
    requestId,
    credentials: { username: username.trim(), password },
  })
  return {
    walletBalanceCents: response.walletBalanceCents,
    stamp: {
      base64: response.png,
      voucherId: response.voucherId,
      shopOrderId: response.shopOrderId,
      productName: response.productName,
      priceCents: response.priceCents,
      boughtAt: new Date().toISOString(),
    },
  }
}
