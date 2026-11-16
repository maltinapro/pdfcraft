import { parseCii } from './parseCii'
import { parseUbl } from './parseUbl'
import { parseXml, type XmlNode } from './xml'
import { EInvoiceParseError, type InvoiceView } from './types'

export * from './types'

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
