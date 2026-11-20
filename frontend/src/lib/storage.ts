import {
  DEFAULT_SETTINGS,
  defaultInvoice,
  DESIGNS,
  type Invoice,
  isObj,
  type Logo,
  MAX_LOGO_BYTES,
  mergeObject,
  newItem,
  type Obj,
  parsePostage,
  type Settings,
  tr,
} from '@pdfcraft/editor'

export { isObj, mergeObject, parsePostage, type Obj }

export const SCHEMA_VERSION = 1
const STORAGE_KEY = 'pdfcraft.config'

export interface AppConfig {
  schemaVersion: number
  settings: Settings
  invoice: Invoice
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
  if (!isObj(raw)) throw new Error(tr('Ungültige Konfigurationsdatei.', 'Invalid configuration file.'))
  const version = raw.schemaVersion
  if (typeof version !== 'number' || version < 1) throw new Error('Unbekannte Schema-Version.')
  if (version > SCHEMA_VERSION) {
    throw new Error(tr(`Konfiguration stammt aus einer neueren Version (${version}).`, `Configuration comes from a newer version (${version}).`))
  }
  // Migrations for older versions go here, one step per version.

  const settings = mergeObject(DEFAULT_SETTINGS as unknown as Obj, raw.settings) as unknown as Settings
  if (!DESIGNS.some(({ value }) => value === settings.design)) settings.design = DEFAULT_SETTINGS.design
  settings.logo = isObj(raw.settings) ? parseLogo(raw.settings.logo) : null
  settings.signature = isObj(raw.settings) ? parseLogo(raw.settings.signature) : null

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
  invoice.postage = parsePostage(rawInvoice.postage)
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
  if (file.size > 1024 * 1024) throw new Error(tr('Datei ist zu groß.', 'File is too large.'))
  let json: unknown
  try {
    json = JSON.parse(await file.text())
  } catch {
    throw new Error(tr('Datei ist kein gültiges JSON.', 'File is not valid JSON.'))
  }
  return parseConfig(json)
}
