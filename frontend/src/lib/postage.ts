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

export interface ProductList {
  products: PostageProduct[]
  /** Test stamps from the Deutsche Post test API (free tokens): not valid for postage, no real money. */
  sandbox: boolean
  /** `false` when the server uses a shared test login, so the user needs no Portokasse. */
  loginRequired: boolean
}

type Products = ProductList | 'disabled'

const CACHE_MS = 10 * 60 * 1000
let cache: { at: number; result: Promise<Products> } | null = null

/** `'disabled'` when the server does not offer stamps (then the form hides the section). */
export function loadProducts(): Promise<Products> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.result
  const result = requestJson<Partial<ProductList>>('GET', '/v1/postage/products').then(
    (r): Products => ({ products: r.products ?? [], sandbox: r.sandbox ?? false, loginRequired: r.loginRequired ?? true }),
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

const credentials = (username: string, password: string) =>
  username.trim() && password ? { username: username.trim(), password } : undefined

/** Buys one stamp. A fresh `requestId` per click makes a repeated request a no-op on the server. */
export async function buyStamp(product: PostageProduct, username: string, password: string): Promise<Purchase> {
  const requestId = crypto.randomUUID()
  const response = await requestJson<PurchaseResponse>('POST', '/v1/postage/stamps', {
    productCode: product.productCode,
    expectedPriceCents: product.priceCents,
    requestId,
    credentials: credentials(username, password),
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

/** Fetches the stamp of an order that was paid but not delivered again; costs no postage. */
export async function recoverStamp(
  shopOrderId: string,
  product: Pick<PostageProduct, 'name' | 'priceCents'>,
  username: string,
  password: string,
): Promise<Purchase> {
  const response = await requestJson<{ stamps: PurchaseResponse[] }>('POST', '/v1/postage/stamps/recover', {
    shopOrderId,
    credentials: credentials(username, password),
  })
  const first = response.stamps[0]
  return {
    walletBalanceCents: null,
    stamp: {
      base64: first.png,
      voucherId: first.voucherId,
      shopOrderId: first.shopOrderId,
      productName: product.name,
      priceCents: product.priceCents,
      boughtAt: new Date().toISOString(),
    },
  }
}
