import { SelectField, TextField } from './ui/Field'
import { ItemsEditor } from './ItemsEditor'
import { RecipientPicker } from './MasterDataPickers'
import { PostageSection } from './PostageSection'
import { tr, useLang } from '../lib/i18n'
import { addIsoDays, type Invoice, type Recipient, type Settings } from '../lib/types'
import type { ZoneId } from '../lib/documents'

interface Props {
  invoice: Invoice
  settings: Settings
  onChange: (invoice: Invoice) => void
  zone: ZoneId
}

export function InvoiceForm({ invoice, settings, onChange, zone }: Props) {
  useLang()
  const setRecipient = (key: keyof Recipient, value: string) =>
    onChange({ ...invoice, recipient: { ...invoice.recipient, [key]: value } })

  return (
    <div className="form">
      {zone === 'details' && (
      <section className="form-section" data-zone="details">
        <h3>{tr('Rechnung', 'Invoice')}</h3>
        <TextField field="number" label={tr('Rechnungsnummer', 'Invoice number')} value={invoice.number} onChange={(v) => onChange({ ...invoice, number: v })} />
        <TextField field="date" label={tr('Rechnungsdatum', 'Invoice date')} type="date" value={invoice.date} onChange={(v) => onChange({ ...invoice, date: v })} />
        <SelectField
          label={tr('Leistungsdatum oder -zeitraum', 'Service date or period')}
          value={invoice.serviceDateFrom || invoice.serviceDateTo ? 'period' : 'date'}
          onChange={(value) => onChange(value === 'period'
            ? {
                ...invoice,
                serviceDate: '',
                serviceDateFrom: invoice.serviceDate || invoice.date,
                serviceDateTo: invoice.serviceDate || invoice.date,
              }
            : {
                ...invoice,
                serviceDate: invoice.serviceDate || invoice.serviceDateFrom || invoice.date,
                serviceDateFrom: '',
                serviceDateTo: '',
              })}
          options={[
            { value: 'date', label: tr('Einzelnes Leistungsdatum', 'Single service date') },
            { value: 'period', label: tr('Leistungszeitraum', 'Service period') },
          ]}
          hint={tr('Standardmäßig das Rechnungsdatum.', 'Defaults to the invoice date.')}
        />
        {invoice.serviceDateFrom || invoice.serviceDateTo ? (
          <>
            <TextField field="serviceDateFrom" label={tr('Leistungszeitraum von', 'Service period from')} type="date" value={invoice.serviceDateFrom ?? ''} onChange={(v) => onChange({ ...invoice, serviceDateFrom: v })} />
            <TextField field="serviceDateTo" label={tr('Leistungszeitraum bis', 'Service period to')} type="date" value={invoice.serviceDateTo ?? ''} onChange={(v) => onChange({ ...invoice, serviceDateTo: v })} />
          </>
        ) : (
          <TextField field="serviceDate" label={tr('Leistungsdatum', 'Date of service')} type="date" value={invoice.serviceDate || invoice.date} onChange={(v) => onChange({ ...invoice, serviceDate: v })} />
        )}
        <TextField
          field="dueDate"
          label={tr('Fälligkeitsdatum', 'Due date')}
          type="date"
          value={invoice.dueDate || addIsoDays(invoice.date, settings.paymentDays)}
          onChange={(v) => onChange({ ...invoice, dueDate: v })}
        />
        {invoice.dueDate && (
          <button type="button" className="btn btn-small btn-tonal" onClick={() => onChange({ ...invoice, dueDate: '' })}>
            {tr('Zahlungsziel verwenden', 'Use payment term')}
          </button>
        )}
      </section>
      )}

      {zone === 'recipient' && (
      <section className="form-section" data-zone="recipient">
        <h3>{tr('Empfänger', 'Recipient')}</h3>
        <RecipientPicker recipient={invoice.recipient} onPick={(recipient) => onChange({ ...invoice, recipient })} autoFocus />
        <TextField field="recipient.name" label={tr('Name', 'Name')} value={invoice.recipient.name} onChange={(v) => setRecipient('name', v)} />
        <TextField field="recipient.address" label={tr('Straße / Hausnummer', 'Street / house number')} value={invoice.recipient.address} onChange={(v) => setRecipient('address', v)} />
        <TextField field="recipient.city" label={tr('PLZ / Ort', 'Postcode / city')} value={invoice.recipient.city} onChange={(v) => setRecipient('city', v)} />
        <TextField field="recipient.email" label={tr('E-Mail', 'E-mail')} type="email" value={invoice.recipient.email} onChange={(v) => setRecipient('email', v)} />
        <TextField field="recipient.vatId" label={tr('USt-IdNr.', 'VAT ID')} value={invoice.recipient.vatId} onChange={(v) => setRecipient('vatId', v)} hint={tr('Optional – bei Geschäftskunden, z. B. innerhalb der EU.', 'Optional – for business customers, e.g. within the EU.')} />
        <TextField
          field="recipient.buyerReference"
          label={tr('Leitweg-ID / Käuferreferenz', 'Leitweg ID / buyer reference')}
          value={invoice.recipient.buyerReference}
          onChange={(v) => setRecipient('buyerReference', v)}
          hint={tr('Nur bei Behörden nötig (Stadt, Land, Bund): Die Nummer erhalten Sie von Ihrem Kunden. Sonst leer lassen.', 'Only needed for public authorities: you get the number from your customer. Otherwise leave empty.')}
        />
      </section>
      )}

      {zone === 'recipient' && <PostageSection postage={invoice.postage} onChange={(postage) => onChange({ ...invoice, postage })} />}

      {zone === 'items' && <ItemsEditor items={invoice.items} onChange={(items) => onChange({ ...invoice, items })} />}
    </div>
  )
}
