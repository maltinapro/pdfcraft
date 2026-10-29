import {
  DEFAULT_SETTINGS,
  MAX_LOGO_BYTES,
  defaultInvoice,
  newItem,
  type Invoice,
  type Logo,
  type Settings,
} from './types'

export const SCHEMA_VERSION = 1
const STORAGE_KEY = 'pdfcraft.config'

export interface AppConfig {
  schemaVersion: number
  settings: Settings
  invoice: Invoice
}

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Copies only keys of `defaults` whose value has the same primitive type; nested objects recurse. */
function mergeObject<T extends Obj>(defaults: T, input: unknown): T {
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

function parseLogo(input: unknown): Logo | null {
  if (!isObj(input)) return null
  const { fileName, base64, mimeType } = input
  if (typeof fileName !== 'string' || typeof base64 !== 'string' || typeof mimeType !== 'string') return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || (base64.length * 3) / 4 > MAX_LOGO_BYTES) return null
  return { fileName, base64, mimeType }
}

/** Validates unknown JSON and migrates older schema versions. Throws on unusable input. */
export function parseConfig(raw: unknown): AppConfig {
  if (!isObj(raw)) throw new Error('Ungültige Konfigurationsdatei.')
  const version = raw.schemaVersion
  if (typeof version !== 'number' || version < 1) throw new Error('Unbekannte Schema-Version.')
  if (version > SCHEMA_VERSION) {
    throw new Error(`Konfiguration stammt aus einer neueren Version (${version}).`)
  }
  // Migrations for older versions go here, one step per version.

  const settings = mergeObject(DEFAULT_SETTINGS as unknown as Obj, raw.settings) as unknown as Settings
  settings.logo = isObj(raw.settings) ? parseLogo(raw.settings.logo) : null

  const defaults = defaultInvoice()
  const rawInvoice = isObj(raw.invoice) ? raw.invoice : {}
  const invoice = mergeObject({ ...defaults, items: [] } as unknown as Obj, rawInvoice) as unknown as Invoice
  const rawItems = Array.isArray(rawInvoice.items) ? rawInvoice.items.slice(0, 200) : []
  invoice.items = rawItems.map((item) => {
    const base = newItem()
    const { id: _id, ...rest } = mergeObject(base as unknown as Obj, item) as Obj
    void _id
    return newItem(rest as Partial<typeof base>)
  })
  return { schemaVersion: SCHEMA_VERSION, settings, invoice }
}

export function loadConfig(): AppConfig | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    return text ? parseConfig(JSON.parse(text)) : null
  } catch {
    return null
  }
}

/** Returns false when the browser refuses to store (quota, private mode). */
export function saveConfig(settings: Settings, invoice: Invoice): boolean {
  try {
    const config: AppConfig = { schemaVersion: SCHEMA_VERSION, settings, invoice }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    return true
  } catch {
    return false
  }
}

export function clearConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function exportConfig(settings: Settings, invoice: Invoice): Blob {
  const config: AppConfig = { schemaVersion: SCHEMA_VERSION, settings, invoice }
  return new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
}

export async function importConfig(file: File): Promise<AppConfig> {
  if (file.size > 1024 * 1024) throw new Error('Datei ist zu groß.')
  let json: unknown
  try {
    json = JSON.parse(await file.text())
  } catch {
    throw new Error('Datei ist kein gültiges JSON.')
  }
  return parseConfig(json)
}
