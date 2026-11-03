import { TextField } from './Field'
import { ItemsEditor } from './ItemsEditor'
import { tr, useLang } from '../lib/i18n'
import type { Invoice, Recipient } from '../lib/types'

interface Props {
  invoice: Invoice
  onChange: (invoice: Invoice) => void
}

export function InvoiceForm({ invoice, onChange }: Props) {
  useLang()
  const setRecipient = (key: keyof Recipient, value: string) =>
    onChange({ ...invoice, recipient: { ...invoice.recipient, [key]: value } })

  return (
    <div className="form">
      <section className="form-section">
        <h3>{tr('Rechnung', 'Invoice')}</h3>
        <TextField label={tr('Rechnungsnummer', 'Invoice number')} value={invoice.number} onChange={(v) => onChange({ ...invoice, number: v })} />
        <TextField label={tr('Rechnungsdatum', 'Invoice date')} type="date" value={invoice.date} onChange={(v) => onChange({ ...invoice, date: v })} />
      </section>

      <section className="form-section">
        <h3>{tr('Empfänger', 'Recipient')}</h3>
        <TextField label={tr('Name', 'Name')} value={invoice.recipient.name} onChange={(v) => setRecipient('name', v)} />
        <TextField label={tr('Straße / Hausnummer', 'Street / house number')} value={invoice.recipient.address} onChange={(v) => setRecipient('address', v)} />
        <TextField label={tr('PLZ / Ort', 'Postcode / city')} value={invoice.recipient.city} onChange={(v) => setRecipient('city', v)} />
        <TextField label={tr('E-Mail', 'E-mail')} type="email" value={invoice.recipient.email} onChange={(v) => setRecipient('email', v)} />
        <TextField label={tr('USt-IdNr.', 'VAT ID')} value={invoice.recipient.vatId} onChange={(v) => setRecipient('vatId', v)} />
        <TextField
          label={tr('Leitweg-ID / Käuferreferenz', 'Leitweg ID / buyer reference')}
          value={invoice.recipient.buyerReference}
          onChange={(v) => setRecipient('buyerReference', v)}
          hint={tr('Nur für Behörden (XRechnung) erforderlich.', 'Only required for public authorities (XRechnung).')}
        />
      </section>

      <ItemsEditor items={invoice.items} onChange={(items) => onChange({ ...invoice, items })} />
    </div>
  )
}
