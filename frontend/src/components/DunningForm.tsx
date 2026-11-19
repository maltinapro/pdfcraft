import { useState } from 'react'
import { Field, SelectField, TextField } from './Field'
import { dunnableInvoices, openInvoiceRow, type ArchiveEntry } from '../lib/archive'
import { newDunningFee, newDunningInvoice, type DunningData, type InterestMode } from '../lib/documents'
import { tr, uiLocale, useLang } from '../lib/i18n'

interface Props {
  zone: 'details' | 'items'
  data: DunningData
  onChange: (data: DunningData) => void
  archive: ArchiveEntry[]
  paymentDays: number
}

const money = (n: number) => n.toLocaleString(uiLocale(), { style: 'currency', currency: 'EUR' })

/** Dunning letter fields: level and deadline (details zone), open invoices, fees and default interest (items zone). */
export function DunningForm({ zone, data, onChange, archive, paymentDays }: Props) {
  useLang()
  const [picking, setPicking] = useState(false)
  const set = (patch: Partial<DunningData>) => onChange({ ...data, ...patch })
  const setInterest = (patch: Partial<DunningData['interest']>) => set({ interest: { ...data.interest, ...patch } })
  const setInvoice = (id: string, patch: Partial<DunningData['invoices'][number]>) =>
    set({ invoices: data.invoices.map((row) => (row.id === id ? { ...row, ...patch } : row)) })
  const setFee = (id: string, patch: Partial<DunningData['fees'][number]>) =>
    set({ fees: data.fees.map((row) => (row.id === id ? { ...row, ...patch } : row)) })

  if (zone === 'details') {
    return (
      <section className="form-section" data-zone="details">
        <h3>{tr('Mahnung', 'Dunning')}</h3>
        <SelectField
          field="dunningLevel"
          label={tr('Mahnstufe', 'Dunning level')}
          value={String(data.level)}
          onChange={(v) => set({ level: Number(v) as DunningData['level'] })}
          options={[
            { value: '1', label: tr('1 – Zahlungserinnerung', '1 – Payment reminder') },
            { value: '2', label: tr('2 – Mahnung', '2 – Dunning letter') },
            { value: '3', label: tr('3 – Letzte Mahnung', '3 – Final notice') },
          ]}
        />
        <TextField field="paymentDeadline" type="date" label={tr('Neue Zahlungsfrist', 'New payment deadline')} value={data.paymentDeadline} onChange={(v) => set({ paymentDeadline: v })} />
      </section>
    )
  }

  const candidates = dunnableInvoices(archive).filter((e) => !data.invoices.some((row) => row.number === e.number))
  const total =
    data.invoices.reduce((sum, row) => sum + Math.round(row.openAmount * 100), 0) +
    data.fees.reduce((sum, row) => sum + Math.round(row.amount * 100), 0) +
    (data.interest.mode === 'manual' ? Math.round(data.interest.amount * 100) : 0)

  return (
    <>
      <section className="form-section" data-zone="items">
        <h3>{tr('Offene Rechnungen', 'Open invoices')}</h3>
        <p className="form-hint">
          {tr(
            'Bei Teilzahlungen den noch offenen Betrag eintragen (brutto). PDFCraft speichert keine Rechnungen und führt kein Offene-Posten-Konto.',
            'After partial payments enter the amount that is still open (gross). PDFCraft stores no invoices and keeps no open-items ledger.',
          )}
        </p>
        {data.invoices.map((row, index) => (
          <div className="item-card" key={row.id}>
            <div className="item-card-header">
              <strong>{tr('Rechnung', 'Invoice')} {index + 1}</strong>
              <span className="item-actions">
                <button type="button" className="btn btn-small" onClick={() => set({ invoices: data.invoices.filter((r) => r.id !== row.id) })}>
                  {tr('Entfernen', 'Remove')}
                </button>
              </span>
            </div>
            <TextField field={`invoices[${index}].number`} label={tr('Rechnungsnummer', 'Invoice number')} value={row.number} onChange={(v) => setInvoice(row.id, { number: v })} />
            <div className="item-row">
              <TextField field={`invoices[${index}].date`} type="date" label={tr('Rechnungsdatum', 'Invoice date')} value={row.date} onChange={(v) => setInvoice(row.id, { date: v })} />
              <TextField field={`invoices[${index}].dueDate`} type="date" label={tr('Fällig am', 'Due on')} value={row.dueDate} onChange={(v) => setInvoice(row.id, { dueDate: v })} />
            </div>
            <Field field={`invoices[${index}].openAmount`} label={tr('Offener Betrag (brutto, €)', 'Open amount (gross, €)')}>
              <input type="number" step="0.01" min={0} value={row.openAmount} onChange={(e) => setInvoice(row.id, { openAmount: Number(e.target.value) })} />
            </Field>
          </div>
        ))}
        <div className="picker-actions">
          <button type="button" className="btn btn-tonal" onClick={() => set({ invoices: [...data.invoices, newDunningInvoice()] })}>
            {tr('+ Rechnung', '+ Invoice')}
          </button>
          <button type="button" className="btn btn-tonal" aria-expanded={picking} disabled={archive.length === 0} onClick={() => setPicking(!picking)}>
            {tr('+ Aus ausgestellten Rechnungen', '+ From issued invoices')}
          </button>
        </div>
        {picking && (
          <div className="picker-panel">
            {candidates.length === 0 ? (
              <p className="form-hint">{tr('Keine weiteren ausgestellten Rechnungen.', 'No more issued invoices.')}</p>
            ) : (
              <ul className="picker-list">
                {candidates.slice(0, 30).map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => {
                        const row = openInvoiceRow(entry, paymentDays)
                        if (row) set({ invoices: [...data.invoices, row] })
                      }}
                    >
                      {entry.number} · {entry.recipient}
                      <span>{entry.date}{entry.total !== null ? ` · ${money(entry.total)}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="form-section" data-zone="items">
        <h3>{tr('Mahngebühren', 'Dunning fees')}</h3>
        {data.fees.map((row, index) => (
          <div className="item-card" key={row.id}>
            <div className="item-card-header">
              <strong>{tr('Gebühr', 'Fee')} {index + 1}</strong>
              <span className="item-actions">
                <button type="button" className="btn btn-small" onClick={() => set({ fees: data.fees.filter((r) => r.id !== row.id) })}>
                  {tr('Entfernen', 'Remove')}
                </button>
              </span>
            </div>
            <TextField field={`fees[${index}].description`} label={tr('Beschreibung', 'Description')} value={row.description} onChange={(v) => setFee(row.id, { description: v })} />
            <Field field={`fees[${index}].amount`} label={tr('Betrag (€)', 'Amount (€)')}>
              <input type="number" step="0.01" min={0} value={row.amount} onChange={(e) => setFee(row.id, { amount: Number(e.target.value) })} />
            </Field>
          </div>
        ))}
        <button type="button" className="btn btn-tonal" onClick={() => set({ fees: [...data.fees, newDunningFee({ description: tr('Mahngebühr', 'Dunning fee') })] })}>
          {tr('+ Gebühr', '+ Fee')}
        </button>
      </section>

      <section className="form-section" data-zone="items">
        <h3>{tr('Verzugszinsen', 'Default interest')}</h3>
        <SelectField
          field="interest.debtor"
          label={tr('Verzugszinsen', 'Default interest')}
          value={data.interest.mode}
          onChange={(v) => setInterest({ mode: v as InterestMode })}
          options={[
            { value: 'none', label: tr('Keine', 'None') },
            { value: 'business', label: tr('Aus dem Basiszinssatz – Unternehmen (+9 Punkte, § 288 Abs. 2)', 'From the base rate – business (+9 points, § 288 (2))') },
            { value: 'consumer', label: tr('Aus dem Basiszinssatz – Verbraucher (+5 Punkte, § 288 Abs. 1)', 'From the base rate – consumer (+5 points, § 288 (1))') },
            { value: 'manual', label: tr('Selbst berechnet (Satz, Zeitraum, Betrag)', 'Calculated by you (rate, period, amount)') },
          ]}
          hint={tr(
            'Die Berechnung erfolgt tagesgenau je Rechnung und Basiszinsperiode; der Beleg weist Zeitraum, Hauptforderung, Satz und Zinsbetrag aus. Verzugszinsen sind nicht umsatzsteuerpflichtig.',
            'Interest is calculated per day, per invoice and per base-rate period; the document shows period, principal, rate and interest amount. Default interest is not subject to VAT.',
          )}
        />
        {data.interest.mode !== 'none' && (
          <div className="item-row">
            <TextField
              field="interest.from"
              type="date"
              label={tr('Zinsen ab (optional)', 'Interest from (optional)')}
              value={data.interest.from}
              onChange={(v) => setInterest({ from: v })}
              hint={data.interest.mode === 'manual' ? undefined : tr('Leer: Tag nach der Fälligkeit', 'Empty: the day after the due date')}
            />
            <TextField
              field="interest.to"
              type="date"
              label={tr('Zinsen bis (optional)', 'Interest to (optional)')}
              value={data.interest.to}
              onChange={(v) => setInterest({ to: v })}
              hint={data.interest.mode === 'manual' ? undefined : tr('Leer: Belegdatum', 'Empty: the document date')}
            />
          </div>
        )}
        {data.interest.mode === 'manual' && (
          <div className="item-row">
            <Field field="interest.rate" label={tr('Zinssatz (% p. a.)', 'Rate (% p.a.)')}>
              <input type="number" step="0.01" min={0} value={data.interest.rate} onChange={(e) => setInterest({ rate: Number(e.target.value) })} />
            </Field>
            <Field field="interest.amount" label={tr('Zinsbetrag (€)', 'Interest amount (€)')}>
              <input type="number" step="0.01" min={0} value={data.interest.amount} onChange={(e) => setInterest({ amount: Number(e.target.value) })} />
            </Field>
          </div>
        )}
        {(data.interest.mode === 'consumer' || data.interest.mode === 'business') && (
          <TextField
            field="interest.baseRate"
            label={tr('Basiszinssatz abweichend (% p. a., optional)', 'Different base rate (% p.a., optional)')}
            value={data.interest.baseRate}
            onChange={(v) => setInterest({ baseRate: v })}
            hint={tr(
              'Leer: Tabelle der Bundesbank-Sätze im Server. Nur nötig, wenn die Tabelle den Zeitraum nicht kennt.',
              'Empty: the server’s table of Bundesbank rates. Only needed if the table does not know the period.',
            )}
          />
        )}
        <p className="form-hint">
          {tr('Summe Hauptforderung + Gebühren', 'Principal + fees')}: <strong>{money((total) / 100)}</strong>
          {data.interest.mode === 'business' || data.interest.mode === 'consumer' ? tr(' (zuzüglich berechneter Zinsen)', ' (plus calculated interest)') : ''}
        </p>
      </section>
    </>
  )
}
