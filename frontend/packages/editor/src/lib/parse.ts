import type { PostageStamp } from './types'

export type Obj = Record<string, unknown>

export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Copies only keys of `defaults` whose value has the same primitive type; nested objects recurse. */
export function mergeObject<T extends Obj>(defaults: T, input: unknown): T {
  const src = isObj(input) ? input : {}
  const out: Obj = { ...defaults }
  for (const key of Object.keys(defaults)) {
    const d = defaults[key]
    const v = src[key]
    if (isObj(d)) out[key] = mergeObject(d, v)
    else if (typeof v === typeof d) out[key] = v
  }
  return out as T
}

/** A stored stamp or `null`; keeps what a purchase paid for even after a reload or import. */
export function parsePostage(input: unknown): PostageStamp | null {
  if (!isObj(input)) return null
  const { base64, voucherId, shopOrderId, productName, priceCents, boughtAt } = input
  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || (base64.length * 3) / 4 > 300 * 1024) return null
  return {
    base64,
    voucherId: typeof voucherId === 'string' ? voucherId : '',
    shopOrderId: typeof shopOrderId === 'string' ? shopOrderId : '',
    productName: typeof productName === 'string' ? productName : '',
    priceCents: typeof priceCents === 'number' ? priceCents : 0,
    boughtAt: typeof boughtAt === 'string' ? boughtAt : '',
  }
}
