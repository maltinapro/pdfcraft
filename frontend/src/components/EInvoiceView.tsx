import type { ReactNode } from 'react'
import { money } from '../lib/einvoice/check'
import { categoryLabel, formatDate, formatNumber, formatPercent, groupIban, meansLabel, typeLabel, unitLabel } from '../lib/einvoice/format'
import type { InvoiceView, Party } from '../lib/einvoice/parse'
import { tr, useLang } from '@maltinapro/editor'

const Row = ({ label, value }: { label: string; value: ReactNode }) =>
  value ? (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  ) : null

function PartyBlock({ title, party }: { title: string; party: Party }) {
  const place = [party.postcode, party.city].filter(Boolean).join(' ')
  return (
    <section className="ev-party">
      <h3>{title}</h3>
      <p className="ev-party-name">{party.name ?? '–'}</p>
      {party.tradeName && <p>{party.tradeName}</p>}
      {[party.street, party.street2, place, party.country].filter(Boolean).map((line, i) => (
        <p key={i}>{line}</p>
      ))}
      <dl className="ev-facts">
        <Row label={tr('USt-IdNr.', 'VAT ID')} value={party.vatId} />
        <Row label={tr('Steuernummer', 'Tax number')} value={party.taxNumber} />
        <Row label={tr('Register', 'Registration')} value={party.registration} />
        <Row label={tr('Kontakt', 'Contact')} value={party.contactName} />
        <Row label={tr('Telefon', 'Phone')} value={party.phone} />
        <Row label={tr('E-Mail', 'Email')} value={party.email} />
      </dl>
    </section>
  )
}

/** The received e-invoice as a readable document. Every optional part is skipped when it is missing in the XML. */
export function EInvoiceView({ view }: { view: InvoiceView }) {
  useLang()
  const cur = view.currency
  const totals = view.totals
  const referenced = view.precedingInvoices.filter((p) => p.number)
  const payments = view.payments.filter((p) => p.iban || p.bic || p.bankName || p.code || p.accountName || p.reference)
  const hasDiscount = view.items.some((l) => l.hasAdjustments)

  return (
    <article className="ev-doc">
      <header className="ev-head">
        <div>
          <h2>{typeLabel(view.typeCode)}</h2>
          <p className="ev-number">{view.number ?? '–'}</p>
        </div>
        <dl className="ev-facts">
          <Row label={tr('Rechnungsdatum', 'Issue date')} value={view.issueDate && formatDate(view.issueDate)} />
          <Row label={tr('Fällig am', 'Due date')} value={view.dueDate && formatDate(view.dueDate)} />
          <Row label={tr('Lieferdatum', 'Delivery date')} value={view.deliveryDate && formatDate(view.deliveryDate)} />
          <Row label={tr('Währung', 'Currency')} value={view.currency} />
          <Row label={tr('Format', 'Format')} value={view.syntax === 'cii' ? 'CII (ZUGFeRD / Factur-X / XRechnung)' : 'UBL (XRechnung / Peppol)'} />
        </dl>
      </header>

      <div className="ev-parties">
        <PartyBlock title={tr('Rechnungssteller', 'Seller')} party={view.seller} />
        <PartyBlock title={tr('Rechnungsempfänger', 'Buyer')} party={view.buyer} />
        {view.payee && <PartyBlock title={tr('Zahlungsempfänger', 'Payee')} party={view.payee} />}
      </div>

      {(view.buyerReference || view.orderReference || view.contractReference || referenced.length > 0) && (
        <dl className="ev-facts ev-refs">
          <Row label={tr('Leitweg-ID / Käuferreferenz', 'Buyer reference')} value={view.buyerReference} />
          <Row label={tr('Bestellnummer', 'Order reference')} value={view.orderReference} />
          <Row label={tr('Vertragsnummer', 'Contract reference')} value={view.contractReference} />
          <Row
            label={view.typeCode === '381' ? tr('Gutschrift zu Rechnung', 'Credit for invoice') : tr('Bezug auf Rechnung', 'Preceding invoice')}
            value={referenced.length > 0 && referenced.map((p) => (p.date ? `${p.number} (${formatDate(p.date)})` : p.number)).join(', ')}
          />
        </dl>
      )}

      {view.notes.length > 0 && (
        <div className="ev-notes">
          {view.notes.map((note, i) => (
            <p key={i}>{note}</p>
          ))}
        </div>
      )}

      <div className="ev-scroll">
        <table className="ev-table">
          <thead>
            <tr>
              <th>{tr('Pos.', 'No.')}</th>
              <th>{tr('Bezeichnung', 'Description')}</th>
              <th className="num">{tr('Menge', 'Quantity')}</th>
              <th className="num">{tr('Einzelpreis', 'Unit price')}</th>
              <th className="num">{tr('USt', 'VAT')}</th>
              <th className="num">{tr('Netto', 'Net')}</th>
            </tr>
          </thead>
          <tbody>
            {view.items.length === 0 && (
              <tr>
                <td colSpan={6} className="ev-empty">{tr('Keine Positionen in der Datei.', 'No lines in the file.')}</td>
              </tr>
            )}
            {view.items.map((line, i) => (
              <tr key={i}>
                <td>{line.id ?? i + 1}</td>
                <td>
                  <strong>{line.name ?? '–'}</strong>
                  {line.description && <div className="ev-sub">{line.description}</div>}
                  {line.note && <div className="ev-sub">{line.note}</div>}
                  {(line.sellerItemId || line.buyerItemId) && (
                    <div className="ev-sub">
                      {[line.sellerItemId && tr(`Art.-Nr. ${line.sellerItemId}`, `Item no. ${line.sellerItemId}`), line.buyerItemId && tr(`Ihre Art.-Nr. ${line.buyerItemId}`, `Your item no. ${line.buyerItemId}`)].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </td>
                <td className="num">
                  {formatNumber(line.quantity)} {unitLabel(line.unit)}
                </td>
                <td className="num">
                  {money(line.price)}
                  {line.priceBasis !== 1 && <div className="ev-sub">{tr(`je ${formatNumber(line.priceBasis)}`, `per ${formatNumber(line.priceBasis)}`)}</div>}
                </td>
                <td className="num">{line.taxRate === null ? line.taxCategory ?? '–' : formatPercent(line.taxRate)}</td>
                <td className="num">{money(line.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasDiscount && <p className="ev-hint">{tr('Mindestens eine Position enthält Rabatte oder Zuschläge; der Positionsbetrag ist bereits damit verrechnet.', 'At least one line contains allowances or charges; the line amount already includes them.')}</p>}

      <div className="ev-bottom">
        <div>
          {view.adjustments.length > 0 && (
            <table className="ev-table ev-small">
              <caption>{tr('Nachlässe und Zuschläge', 'Allowances and charges')}</caption>
              <tbody>
                {view.adjustments.map((a, i) => (
                  <tr key={i}>
                    <td>{a.charge ? tr('Zuschlag', 'Charge') : tr('Nachlass', 'Allowance')}{a.reason ? `: ${a.reason}` : ''}</td>
                    <td className="num">{a.taxRate !== null && formatPercent(a.taxRate)}</td>
                    <td className="num">{money(a.charge ? a.amount : a.amount === null ? null : -a.amount, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {view.taxes.length > 0 && (
            <table className="ev-table ev-small">
              <caption>{tr('Umsatzsteuer', 'VAT breakdown')}</caption>
              <thead>
                <tr>
                  <th>{tr('Kategorie', 'Category')}</th>
                  <th className="num">{tr('Satz', 'Rate')}</th>
                  <th className="num">{tr('Basis', 'Basis')}</th>
                  <th className="num">{tr('Steuer', 'Tax')}</th>
                </tr>
              </thead>
              <tbody>
                {view.taxes.map((x, i) => (
                  <tr key={i}>
                    <td>
                      {x.category ?? '–'} · {categoryLabel(x.category)}
                      {(x.exemptionReason || x.exemptionCode) && <div className="ev-sub">{[x.exemptionReason, x.exemptionCode].filter(Boolean).join(' · ')}</div>}
                    </td>
                    <td className="num">{formatPercent(x.rate)}</td>
                    <td className="num">{money(x.basis)}</td>
                    <td className="num">{money(x.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <table className="ev-table ev-totals">
          <tbody>
            <tr><td>{tr('Summe Positionen', 'Lines total')}</td><td className="num">{money(totals.lineTotal, cur)}</td></tr>
            {(totals.allowanceTotal ?? 0) !== 0 && <tr><td>{tr('Nachlässe', 'Allowances')}</td><td className="num">−{money(totals.allowanceTotal, cur)}</td></tr>}
            {(totals.chargeTotal ?? 0) !== 0 && <tr><td>{tr('Zuschläge', 'Charges')}</td><td className="num">{money(totals.chargeTotal, cur)}</td></tr>}
            <tr><td>{tr('Netto', 'Net total')}</td><td className="num">{money(totals.taxBasis, cur)}</td></tr>
            <tr><td>{tr('Umsatzsteuer', 'VAT')}</td><td className="num">{money(totals.taxTotal, cur)}</td></tr>
            <tr><td>{tr('Brutto', 'Gross total')}</td><td className="num">{money(totals.grandTotal, cur)}</td></tr>
            {(totals.prepaid ?? 0) !== 0 && <tr><td>{tr('Bereits gezahlt', 'Prepaid')}</td><td className="num">−{money(totals.prepaid, cur)}</td></tr>}
            {(totals.rounding ?? 0) !== 0 && <tr><td>{tr('Rundung', 'Rounding')}</td><td className="num">{money(totals.rounding, cur)}</td></tr>}
            <tr className="ev-due"><td>{view.typeCode === '381' ? tr('Gutschriftsbetrag', 'Credit amount') : tr('Zahlbetrag', 'Amount due')}</td><td className="num">{money(totals.due, cur)}</td></tr>
          </tbody>
        </table>
      </div>

      {(payments.length > 0 || view.paymentTerms || view.paymentReference) && (
        <section className="ev-payment">
          <h3>{tr('Zahlung', 'Payment')}</h3>
          {view.paymentTerms && <p>{view.paymentTerms}</p>}
          {payments.map((p, i) => (
            <dl className="ev-facts" key={i}>
              <Row label={tr('Zahlungsart', 'Payment means')} value={p.code && meansLabel(p.code)} />
              <Row label={tr('Kontoinhaber', 'Account holder')} value={p.accountName} />
              <Row label="IBAN" value={p.iban && groupIban(p.iban)} />
              <Row label="BIC" value={p.bic} />
              <Row label={tr('Bank', 'Bank')} value={p.bankName} />
              <Row label={tr('Verwendungszweck', 'Payment reference')} value={p.reference ?? view.paymentReference} />
            </dl>
          ))}
          {payments.length === 0 && view.paymentReference && (
            <dl className="ev-facts">
              <Row label={tr('Verwendungszweck', 'Payment reference')} value={view.paymentReference} />
            </dl>
          )}
        </section>
      )}
    </article>
  )
}
