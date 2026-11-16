/** One syntax-independent view of a received e-invoice (CII: ZUGFeRD/Factur-X/XRechnung CII, UBL: XRechnung UBL/Peppol). */
export interface InvoiceView {
  syntax: 'cii' | 'ubl'
  /** UNTDID 1001 code from BT-3 (380 invoice, 381 credit note, ...). */
  typeCode?: string
  /** Specification identifier (BT-24), e.g. `urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0`. */
  profile?: string
  number?: string
  /** ISO dates (`YYYY-MM-DD`) */
  issueDate?: string
  dueDate?: string
  deliveryDate?: string
  currency?: string
  buyerReference?: string
  orderReference?: string
  contractReference?: string
  paymentReference?: string
  precedingInvoices: { number: string; date?: string }[]
  seller: Party
  buyer: Party
  payee?: Party
  notes: string[]
  items: LineView[]
  /** Document level allowances and charges. */
  adjustments: Adjustment[]
  taxes: TaxView[]
  totals: Totals
  payments: PaymentMeans[]
  paymentTerms?: string
}

export interface Party {
  name?: string
  tradeName?: string
  street?: string
  street2?: string
  postcode?: string
  city?: string
  country?: string
  vatId?: string
  taxNumber?: string
  /** Legal registration (e.g. commercial register number). */
  registration?: string
  contactName?: string
  phone?: string
  email?: string
}

export interface LineView {
  id?: string
  name?: string
  description?: string
  note?: string
  sellerItemId?: string
  buyerItemId?: string
  quantity: number | null
  unit?: string
  /** Net unit price (BT-146). */
  price: number | null
  /** Quantity the price refers to (BT-149), 1 when not given. */
  priceBasis: number
  /** Net line amount (BT-131). */
  net: number | null
  /** The line has its own allowances or charges, so quantity × price does not have to equal the net amount. */
  hasAdjustments: boolean
  taxCategory?: string
  taxRate: number | null
}

export interface Adjustment {
  charge: boolean
  amount: number | null
  reason?: string
  taxCategory?: string
  taxRate: number | null
}

export interface TaxView {
  category?: string
  rate: number | null
  basis: number | null
  amount: number | null
  exemptionReason?: string
  exemptionCode?: string
}

export interface Totals {
  lineTotal: number | null
  allowanceTotal: number | null
  chargeTotal: number | null
  /** Total without VAT (BT-109). */
  taxBasis: number | null
  taxTotal: number | null
  /** Total with VAT (BT-112). */
  grandTotal: number | null
  prepaid: number | null
  rounding: number | null
  /** Amount due for payment (BT-115). */
  due: number | null
}

export interface PaymentMeans {
  /** UNTDID 4461 code (58 SEPA credit transfer, 59 SEPA direct debit, 30 credit transfer, ...). */
  code?: string
  iban?: string
  bic?: string
  bankName?: string
  accountName?: string
  reference?: string
}

/** Why a file could not be turned into a view. */
export type ParseErrorCode = 'invalid_xml' | 'unsupported_root' | 'zugferd1'

export class EInvoiceParseError extends Error {
  readonly code: ParseErrorCode
  constructor(code: ParseErrorCode, message: string) {
    super(message)
    this.code = code
  }
}
