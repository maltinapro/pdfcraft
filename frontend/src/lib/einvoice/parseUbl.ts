import type { Adjustment, InvoiceView, LineView, Party, PaymentMeans, TaxView } from './types'
import { definedList, isoDate, num } from './parseUtil'
import { find, findAll, kids, text, type XmlNode } from './xml'

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

export function parseUbl(root: XmlNode): InvoiceView {
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
