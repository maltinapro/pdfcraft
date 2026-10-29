import { Field, TextField } from './Field'
import {
  TAX_RATES,
  UNITS,
  newItem,
  type Invoice,
  type InvoiceItem,
  type Recipient,
} from '../lib/types'

interface Props {
  invoice: Invoice
  onChange: (invoice: Invoice) => void
}

export function InvoiceForm({ invoice, onChange }: Props) {
  const setRecipient = (key: keyof Recipient, value: string) =>
    onChange({ ...invoice, recipient: { ...invoice.recipient, [key]: value } })

  const setItem = (id: string, patch: Partial<InvoiceItem>) =>
    onChange({
      ...invoice,
      items: invoice.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    })

  const removeItem = (id: string) =>
    onChange({ ...invoice, items: invoice.items.filter((item) => item.id !== id) })

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

      <section className="form-section">
        <h3>Positionen</h3>
        {invoice.items.map((item, index) => (
          <div className="item-card" key={item.id}>
            <div className="item-card-header">
              <strong>Position {index + 1}</strong>
              <button type="button" className="btn btn-small" onClick={() => removeItem(item.id)}>
                Entfernen
              </button>
            </div>
            <TextField label="Beschreibung" value={item.description} onChange={(v) => setItem(item.id, { description: v })} />
            <div className="item-row">
              <Field label="Menge">
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={item.quantity}
                  onChange={(e) => setItem(item.id, { quantity: Number(e.target.value) })}
                />
              </Field>
              <Field label="Einheit">
                <select value={item.unit} onChange={(e) => setItem(item.id, { unit: e.target.value })}>
                  {UNITS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="item-row">
              <Field label="Einzelpreis (netto)">
                <input
                  type="number"
                  step="0.01"
                  value={item.price}
                  onChange={(e) => setItem(item.id, { price: Number(e.target.value) })}
                />
              </Field>
              <Field label="USt.">
                <select
                  value={item.taxRate}
                  onChange={(e) => setItem(item.id, { taxRate: Number(e.target.value) })}
                >
                  {TAX_RATES.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate} %
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn"
          onClick={() => onChange({ ...invoice, items: [...invoice.items, newItem()] })}
        >
          + Position hinzufügen
        </button>
      </section>
    </div>
  )
}
