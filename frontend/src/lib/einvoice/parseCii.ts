import type { Adjustment, InvoiceView, LineView, Party, PaymentMeans, TaxView } from './types'
import { definedList, isoDate, num } from './parseUtil'
import { find, findAll, kids, text, type XmlNode } from './xml'

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

export function parseCii(root: XmlNode): InvoiceView {
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
