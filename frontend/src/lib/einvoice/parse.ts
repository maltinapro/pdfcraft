import { find, findAll, kids, parseXml, text, type XmlNode } from './xml'

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

const num = (value: string | undefined): number | null => {
  if (value === undefined) return null
  const n = Number(value.trim())
  return value.trim() !== '' && Number.isFinite(n) ? n : null
}

/** CII dates use UN/EDIFACT formats (102 = `YYYYMMDD`); UBL uses ISO dates. Returns an ISO date. */
function isoDate(value: string | undefined, format?: string): string | undefined {
  if (!value) return undefined
  const v = value.trim()
  if (/^\d{8}$/.test(v) && (!format || format === '102')) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(v)
  return iso ? iso[1] : v
}

const definedList = <T>(list: (T | undefined)[]): T[] => list.filter((x): x is T => x !== undefined)

// ------------------------------------------------------------------ CII

function ciiParty(party: XmlNode | undefined): Party {
  const address = find(party, 'PostalTradeAddress')
  const registrations = findAll(party, 'SpecifiedTaxRegistration/ID')
  const contact = find(party, 'DefinedTradeContact')
  return {
    name: text(party, 'Name'),
    street: text(address, 'LineOne'),
    street2: text(address, 'LineTwo') ?? text(address, 'LineThree'),
    postcode: text(address, 'PostcodeCode'),
    city: text(address, 'CityName'),
    country: text(address, 'CountryID'),
    vatId: registrations.find((r) => r.attrs.schemeID === 'VA')?.text || undefined,
    taxNumber: registrations.find((r) => r.attrs.schemeID === 'FC')?.text || undefined,
    registration: text(party, 'SpecifiedLegalOrganization/ID'),
    contactName: text(contact, 'PersonName') ?? text(contact, 'DepartmentName'),
    phone: text(contact, 'TelephoneUniversalCommunication/CompleteNumber'),
    email: text(contact, 'EmailURIUniversalCommunication/URIID'),
  }
}

function ciiDate(node: XmlNode | undefined): string | undefined {
  const date = find(node, 'DateTimeString')
  return isoDate(date?.text, date?.attrs.format)
}

function parseCii(root: XmlNode): InvoiceView {
  const doc = find(root, 'ExchangedDocument')
  const trade = find(root, 'SupplyChainTradeTransaction')
  const agreement = find(trade, 'ApplicableHeaderTradeAgreement')
  const delivery = find(trade, 'ApplicableHeaderTradeDelivery')
  const settlement = find(trade, 'ApplicableHeaderTradeSettlement')
  const sum = find(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation')
  const taxCurrency = text(settlement, 'TaxCurrencyCode')
  const currency = text(settlement, 'InvoiceCurrencyCode')

  const items: LineView[] = kids(trade, 'IncludedSupplyChainTradeLineItem').map((line) => {
    const lineTax = find(line, 'SpecifiedLineTradeSettlement/ApplicableTradeTax')
    const quantity = find(line, 'SpecifiedLineTradeDelivery/BilledQuantity')
    const basis = find(line, 'SpecifiedLineTradeAgreement/NetPriceProductTradePrice/BasisQuantity')
    return {
      id: text(line, 'AssociatedDocumentLineDocument/LineID'),
      name: text(line, 'SpecifiedTradeProduct/Name'),
      description: text(line, 'SpecifiedTradeProduct/Description'),
      note: text(line, 'AssociatedDocumentLineDocument/IncludedNote/Content'),
      sellerItemId: text(line, 'SpecifiedTradeProduct/SellerAssignedID'),
      buyerItemId: text(line, 'SpecifiedTradeProduct/BuyerAssignedID'),
      quantity: num(quantity?.text),
      unit: quantity?.attrs.unitCode,
      price: num(text(line, 'SpecifiedLineTradeAgreement/NetPriceProductTradePrice/ChargeAmount')),
      priceBasis: num(basis?.text) || 1,
      net: num(text(line, 'SpecifiedLineTradeSettlement/SpecifiedTradeSettlementLineMonetarySummation/LineTotalAmount')),
      hasAdjustments: kids(find(line, 'SpecifiedLineTradeSettlement'), 'SpecifiedTradeAllowanceCharge').length > 0,
      taxCategory: text(lineTax, 'CategoryCode'),
      taxRate: num(text(lineTax, 'RateApplicablePercent')),
    }
  })

  const adjustments: Adjustment[] = kids(settlement, 'SpecifiedTradeAllowanceCharge').map((a) => ({
    charge: text(a, 'ChargeIndicator/Indicator') === 'true',
    amount: num(text(a, 'ActualAmount')),
    reason: text(a, 'Reason'),
    taxCategory: text(a, 'CategoryTradeTax/CategoryCode'),
    taxRate: num(text(a, 'CategoryTradeTax/RateApplicablePercent')),
  }))

  const taxes: TaxView[] = kids(settlement, 'ApplicableTradeTax').map((t) => ({
    category: text(t, 'CategoryCode'),
    rate: num(text(t, 'RateApplicablePercent')),
    basis: num(text(t, 'BasisAmount')),
    amount: num(text(t, 'CalculatedAmount')),
    exemptionReason: text(t, 'ExemptionReason'),
    exemptionCode: text(t, 'ExemptionReasonCode'),
  }))

  // The tax total in the invoice currency (the other one is in the VAT accounting currency BT-6)
  const taxTotals = kids(sum, 'TaxTotalAmount')
  const taxTotal = taxTotals.find((t) => !taxCurrency || !t.attrs.currencyID || t.attrs.currencyID === currency) ?? taxTotals[0]

  const payments: PaymentMeans[] = kids(settlement, 'SpecifiedTradeSettlementPaymentMeans').map((p) => ({
    code: text(p, 'TypeCode'),
    iban: text(p, 'PayeePartyCreditorFinancialAccount/IBANID'),
    bic: text(p, 'PayeeSpecifiedCreditorFinancialInstitution/BICID'),
    bankName: text(p, 'PayeeSpecifiedCreditorFinancialInstitution/Name'),
    accountName: text(p, 'PayeePartyCreditorFinancialAccount/AccountName'),
  }))

  const terms = kids(settlement, 'SpecifiedTradePaymentTerms')
  const payee = find(settlement, 'PayeeTradeParty')

  return {
    syntax: 'cii',
    typeCode: text(doc, 'TypeCode'),
    profile: text(root, 'ExchangedDocumentContext/GuidelineSpecifiedDocumentContextParameter/ID'),
    number: text(doc, 'ID'),
    issueDate: ciiDate(find(doc, 'IssueDateTime')),
    dueDate: ciiDate(find(terms[0], 'DueDateDateTime')),
    deliveryDate: ciiDate(find(delivery, 'ActualDeliverySupplyChainEvent/OccurrenceDateTime')),
    currency,
    buyerReference: text(agreement, 'BuyerReference'),
    orderReference: text(agreement, 'BuyerOrderReferencedDocument/IssuerAssignedID'),
    contractReference: text(agreement, 'ContractReferencedDocument/IssuerAssignedID'),
    paymentReference: text(settlement, 'PaymentReference'),
    precedingInvoices: kids(settlement, 'InvoiceReferencedDocument').map((d) => ({
      number: text(d, 'IssuerAssignedID') ?? '',
      date: ciiDate(find(d, 'FormattedIssueDateTime')),
    })),
    seller: ciiParty(find(agreement, 'SellerTradeParty')),
    buyer: ciiParty(find(agreement, 'BuyerTradeParty')),
    payee: payee ? ciiParty(payee) : undefined,
    notes: definedList(kids(doc, 'IncludedNote').map((n) => text(n, 'Content'))),
    items,
    adjustments,
    taxes,
    totals: {
      lineTotal: num(text(sum, 'LineTotalAmount')),
      allowanceTotal: num(text(sum, 'AllowanceTotalAmount')),
      chargeTotal: num(text(sum, 'ChargeTotalAmount')),
      taxBasis: num(text(sum, 'TaxBasisTotalAmount')),
      taxTotal: num(taxTotal?.text),
      grandTotal: num(text(sum, 'GrandTotalAmount')),
      prepaid: num(text(sum, 'TotalPrepaidAmount')),
      rounding: num(text(sum, 'RoundingAmount')),
      due: num(text(sum, 'DuePayableAmount')),
    },
    payments,
    paymentTerms: definedList(terms.map((t) => text(t, 'Description'))).join('\n') || undefined,
  }
}

// ------------------------------------------------------------------ UBL

function uAddress(party: XmlNode | undefined): Partial<Party> {
  const a = find(party, 'PostalAddress')
  return {
    street: text(a, 'StreetName'),
    street2: text(a, 'AdditionalStreetName'),
    postcode: text(a, 'PostalZone'),
    city: text(a, 'CityName'),
    country: text(a, 'Country/IdentificationCode'),
  }
}

function ublParty(wrapper: XmlNode | undefined): Party {
  const party = find(wrapper, 'Party') ?? wrapper
  const schemes = findAll(party, 'PartyTaxScheme')
  const legal = find(party, 'PartyLegalEntity')
  const vat = schemes.find((s) => text(s, 'TaxScheme/ID')?.toUpperCase() === 'VAT')
  const other = schemes.find((s) => text(s, 'TaxScheme/ID')?.toUpperCase() !== 'VAT')
  const trading = text(party, 'PartyName/Name')
  const registered = text(legal, 'RegistrationName')
  return {
    name: registered ?? trading,
    tradeName: registered && trading && registered !== trading ? trading : undefined,
    ...uAddress(party),
    vatId: text(vat, 'CompanyID'),
    taxNumber: text(other, 'CompanyID'),
    registration: text(legal, 'CompanyID'),
    contactName: text(party, 'Contact/Name'),
    phone: text(party, 'Contact/Telephone'),
    email: text(party, 'Contact/ElectronicMail'),
  }
}

function parseUbl(root: XmlNode): InvoiceView {
  const credit = root.name === 'CreditNote'
  const lineName = credit ? 'CreditNoteLine' : 'InvoiceLine'
  const qtyName = credit ? 'CreditedQuantity' : 'InvoicedQuantity'
  const terms = kids(root, 'PaymentTerms')

  const items: LineView[] = kids(root, lineName).map((line) => {
    const quantity = find(line, qtyName)
    const base = find(line, 'Price/BaseQuantity')
    return {
      id: text(line, 'ID'),
      name: text(line, 'Item/Name'),
      description: text(line, 'Item/Description'),
      note: text(line, 'Note'),
      sellerItemId: text(line, 'Item/SellersItemIdentification/ID'),
      buyerItemId: text(line, 'Item/BuyersItemIdentification/ID'),
      quantity: num(quantity?.text),
      unit: quantity?.attrs.unitCode,
      price: num(text(line, 'Price/PriceAmount')),
      priceBasis: num(base?.text) || 1,
      net: num(text(line, 'LineExtensionAmount')),
      hasAdjustments: kids(line, 'AllowanceCharge').length > 0,
      taxCategory: text(line, 'Item/ClassifiedTaxCategory/ID'),
      taxRate: num(text(line, 'Item/ClassifiedTaxCategory/Percent')),
    }
  })

  const adjustments: Adjustment[] = kids(root, 'AllowanceCharge').map((a) => ({
    charge: text(a, 'ChargeIndicator') === 'true',
    amount: num(text(a, 'Amount')),
    reason: text(a, 'AllowanceChargeReason'),
    taxCategory: text(a, 'TaxCategory/ID'),
    taxRate: num(text(a, 'TaxCategory/Percent')),
  }))

  const taxCurrency = text(root, 'TaxCurrencyCode')
  const currency = text(root, 'DocumentCurrencyCode')
  const taxTotals = kids(root, 'TaxTotal')
  const mainTaxTotal = taxTotals.find((t) => !taxCurrency || taxCurrency === currency || find(t, 'TaxAmount')?.attrs.currencyID !== taxCurrency) ?? taxTotals[0]
  const taxes: TaxView[] = findAll(mainTaxTotal, 'TaxSubtotal').map((t) => ({
    category: text(t, 'TaxCategory/ID'),
    rate: num(text(t, 'TaxCategory/Percent')),
    basis: num(text(t, 'TaxableAmount')),
    amount: num(text(t, 'TaxAmount')),
    exemptionReason: text(t, 'TaxCategory/TaxExemptionReason'),
    exemptionCode: text(t, 'TaxCategory/TaxExemptionReasonCode'),
  }))

  const monetary = find(root, 'LegalMonetaryTotal')
  const payments: PaymentMeans[] = kids(root, 'PaymentMeans').map((p) => ({
    code: text(p, 'PaymentMeansCode'),
    iban: text(p, 'PayeeFinancialAccount/ID'),
    bic: text(p, 'PayeeFinancialAccount/FinancialInstitutionBranch/ID'),
    bankName: text(p, 'PayeeFinancialAccount/FinancialInstitutionBranch/Name'),
    accountName: text(p, 'PayeeFinancialAccount/Name'),
    reference: text(p, 'PaymentID'),
  }))

  return {
    syntax: 'ubl',
    typeCode: text(root, credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'),
    profile: text(root, 'CustomizationID'),
    number: text(root, 'ID'),
    issueDate: isoDate(text(root, 'IssueDate')),
    dueDate: isoDate(text(root, credit ? 'PaymentMeans/PaymentDueDate' : 'DueDate')),
    deliveryDate: isoDate(text(root, 'Delivery/ActualDeliveryDate')),
    currency,
    buyerReference: text(root, 'BuyerReference'),
    orderReference: text(root, 'OrderReference/ID'),
    contractReference: text(root, 'ContractDocumentReference/ID'),
    paymentReference: payments.find((p) => p.reference)?.reference,
    precedingInvoices: findAll(root, 'BillingReference/InvoiceDocumentReference').map((d) => ({
      number: text(d, 'ID') ?? '',
      date: isoDate(text(d, 'IssueDate')),
    })),
    seller: ublParty(find(root, 'AccountingSupplierParty')),
    buyer: ublParty(find(root, 'AccountingCustomerParty')),
    payee: find(root, 'PayeeParty') ? ublParty(find(root, 'PayeeParty')) : undefined,
    notes: kids(root, 'Note').map((n) => n.text).filter(Boolean),
    items,
    adjustments,
    taxes,
    totals: {
      lineTotal: num(text(monetary, 'LineExtensionAmount')),
      allowanceTotal: num(text(monetary, 'AllowanceTotalAmount')),
      chargeTotal: num(text(monetary, 'ChargeTotalAmount')),
      taxBasis: num(text(monetary, 'TaxExclusiveAmount')),
      taxTotal: num(find(mainTaxTotal, 'TaxAmount')?.text),
      grandTotal: num(text(monetary, 'TaxInclusiveAmount')),
      prepaid: num(text(monetary, 'PrepaidAmount')),
      rounding: num(text(monetary, 'PayableRoundingAmount')),
      due: num(text(monetary, 'PayableAmount')),
    },
    payments,
    paymentTerms: definedList(terms.map((t) => text(t, 'Note'))).join('\n') || undefined,
  }
}

/** Reads a CII or UBL e-invoice. Missing optional parts stay `undefined`; only an unreadable file or an unsupported syntax throws. */
export function parseEInvoice(xml: string): InvoiceView {
  let root: XmlNode
  try {
    root = parseXml(xml)
  } catch (e) {
    throw new EInvoiceParseError('invalid_xml', e instanceof Error ? e.message : String(e))
  }
  if (root.name === 'CrossIndustryInvoice') return parseCii(root)
  if (root.name === 'Invoice' || root.name === 'CreditNote') return parseUbl(root)
  if (root.name === 'CrossIndustryDocument') {
    throw new EInvoiceParseError('zugferd1', 'ZUGFeRD 1.x (CrossIndustryDocument) is not supported')
  }
  throw new EInvoiceParseError('unsupported_root', `Unsupported root element <${root.name}>`)
}
