import { TextField } from './Field'
import { ItemsEditor } from './ItemsEditor'
import type { Invoice, Recipient } from '../lib/types'

interface Props {
  invoice: Invoice
  onChange: (invoice: Invoice) => void
}

export function InvoiceForm({ invoice, onChange }: Props) {
  const setRecipient = (key: keyof Recipient, value: string) =>
    onChange({ ...invoice, recipient: { ...invoice.recipient, [key]: value } })

  return (
    <div className="form">
      <section className="form-section">
        <h3>Rechnung</h3>
        <TextField label="Rechnungsnummer" value={invoice.number} onChange={(v) => onChange({ ...invoice, number: v })} />
        <TextField label="Rechnungsdatum" type="date" value={invoice.date} onChange={(v) => onChange({ ...invoice, date: v })} />
      </section>

      <section className="form-section">
        <h3>Empfänger</h3>
        <TextField label="Name" value={invoice.recipient.name} onChange={(v) => setRecipient('name', v)} />
        <TextField label="Straße / Hausnummer" value={invoice.recipient.address} onChange={(v) => setRecipient('address', v)} />
        <TextField label="PLZ / Ort" value={invoice.recipient.city} onChange={(v) => setRecipient('city', v)} />
        <TextField label="E-Mail" type="email" value={invoice.recipient.email} onChange={(v) => setRecipient('email', v)} />
        <TextField label="USt-IdNr." value={invoice.recipient.vatId} onChange={(v) => setRecipient('vatId', v)} />
        <TextField
          label="Leitweg-ID / Käuferreferenz"
          value={invoice.recipient.buyerReference}
          onChange={(v) => setRecipient('buyerReference', v)}
          hint="Nur für Behörden (XRechnung) erforderlich."
        />
      </section>

      <ItemsEditor items={invoice.items} onChange={(items) => onChange({ ...invoice, items })} />
    </div>
  )
}
