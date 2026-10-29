import invoiceTemplate from '../template/invoice.typ?raw'
import {
  FONTS,
  LOCALES,
  TAX_RATES,
  UNITS,
  type Invoice,
  type Settings,
} from './types'

export interface PdfRequest {
  template: string
  data: unknown
  assets: Record<string, string>
}

const MAX_NUMBER = 1e9

/** Values are placed in Typst string literals, so only `\` and `"` need escaping. */
export function escapeTypstString(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_NUMBER, Math.max(-MAX_NUMBER, n))
}

function oneOf<T extends string | number>(value: T, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value) ? value : fallback
}

function parseDate(iso: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  const date = match ? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])) : new Date()
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

function escapeAll<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      typeof value === 'string' ? escapeTypstString(value) : value,
    ]),
  ) as T
}

/** Builds the `POST /generate-pdf` body; everything is validated or escaped here. */
export function buildRequest(settings: Settings, invoice: Invoice): PdfRequest {
  const accentColor = /^#[0-9a-fA-F]{6}$/.test(settings.accentColor)
    ? settings.accentColor
    : '#1d4ed8'

  const data = {
    settings: {
      accentColor,
      font: oneOf(settings.font as (typeof FONTS)[number], FONTS, FONTS[0]),
      locale: oneOf(
        settings.locale,
        LOCALES.map((l) => l.value),
        LOCALES[0].value,
      ),
      zugferd: settings.zugferd,
      footer: escapeTypstString(settings.footer),
      intro: escapeTypstString(settings.intro),
      closing: escapeTypstString(settings.closing),
      exemptionReason: escapeTypstString(settings.exemptionReason),
      paymentDays: Math.max(0, Math.round(num(settings.paymentDays, 14))),
      sender: escapeAll({ ...settings.sender }),
      bank: escapeAll({ ...settings.bank }),
    },
    invoice: {
      number: escapeTypstString(invoice.number),
      date: parseDate(invoice.date),
      recipient: escapeAll({ ...invoice.recipient }),
      items: invoice.items.map((item) => ({
        description: escapeTypstString(item.description),
        price: num(item.price),
        quantity: num(item.quantity),
        unit: oneOf(
          item.unit,
          UNITS.map((u) => u.value),
          'pcs',
        ),
        taxRate: oneOf(item.taxRate, TAX_RATES, 19),
      })),
    },
  }

  const assets: Record<string, string> = {}
  if (settings.logo) assets.logo = settings.logo.base64

  return { template: invoiceTemplate, data, assets }
}
