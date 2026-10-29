export interface Sender {
  name: string
  address: string
  city: string
  taxNr: string
  vatId: string
  email: string
  phone: string
}

export interface Bank {
  name: string
  iban: string
  bic: string
}

export interface Logo {
  fileName: string
  /** Base64 without the data URL prefix. */
  base64: string
  mimeType: string
}

export interface Settings {
  logo: Logo | null
  sender: Sender
  accentColor: string
  font: string
  locale: string
  footer: string
  intro: string
  closing: string
  paymentDays: number
  bank: Bank
  zugferd: boolean
}

export interface Recipient {
  name: string
  address: string
  city: string
  vatId: string
  email: string
  buyerReference: string
}

export interface InvoiceItem {
  id: string
  description: string
  quantity: number
  unit: string
  price: number
  taxRate: number
}

export interface Invoice {
  number: string
  /** ISO date, `YYYY-MM-DD`. */
  date: string
  recipient: Recipient
  items: InvoiceItem[]
}

export const FONTS = [
  'Liberation Sans',
  'Liberation Serif',
  'Libertinus Serif',
  'New Computer Modern',
  'DejaVu Sans Mono',
] as const

export const LOCALES = [
  { value: 'de-de', label: 'Deutsch' },
  { value: 'en-de', label: 'English' },
] as const

export const UNITS = [
  { value: 'pcs', label: 'Stück' },
  { value: 'h', label: 'Stunden' },
  { value: 'd', label: 'Tage' },
  { value: 'mo', label: 'Monate' },
  { value: 'y', label: 'Jahre' },
  { value: 'flat', label: 'Pauschal' },
  { value: 'kg', label: 'kg' },
  { value: 'm', label: 'm' },
  { value: 'km', label: 'km' },
  { value: 'm2', label: 'm²' },
  { value: 'l', label: 'Liter' },
] as const

export const TAX_RATES = [19, 7, 0] as const

export const MAX_LOGO_BYTES = 300 * 1024

export const DEFAULT_SETTINGS: Settings = {
  logo: null,
  sender: {
    name: 'Muster GmbH',
    address: 'Musterstraße 1',
    city: '12345 Musterstadt',
    taxNr: '123/456/78901',
    vatId: 'DE123456789',
    email: 'info@muster.example',
    phone: '',
  },
  accentColor: '#1d4ed8',
  font: 'Liberation Sans',
  locale: 'de-de',
  footer: '',
  intro: '',
  closing: 'Vielen Dank für Ihren Auftrag.',
  paymentDays: 14,
  bank: { name: 'Musterbank', iban: 'DE07100202005821158846', bic: 'EXAMPLEBICX' },
  zugferd: true,
}

let itemCounter = 0
export function newItem(partial: Partial<InvoiceItem> = {}): InvoiceItem {
  itemCounter += 1
  return {
    id: `item-${itemCounter}`,
    description: '',
    quantity: 1,
    unit: 'pcs',
    price: 0,
    taxRate: 19,
    ...partial,
  }
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function defaultInvoice(): Invoice {
  const year = new Date().getFullYear()
  return {
    number: `${year}-001`,
    date: todayIso(),
    recipient: {
      name: 'Kunde AG',
      address: 'Kundenweg 5',
      city: '54321 Kundenstadt',
      vatId: '',
      email: 'buchhaltung@kunde.example',
      buyerReference: '',
    },
    items: [
      newItem({ description: 'Beratung', quantity: 8, unit: 'h', price: 95 }),
      newItem({ description: 'Hosting', quantity: 12, unit: 'mo', price: 15 }),
    ],
  }
}
