import { TextAreaField, TextField } from './Field'
import { ItemsEditor } from './ItemsEditor'
import { tr, useLang } from '../lib/i18n'
import type { Doc, DocSpec } from '../lib/documents'

interface Props {
  spec: DocSpec
  doc: Doc
  onChange: (doc: Doc) => void
}

/** Generic form for all non-invoice documents, built from the type's `DocSpec`. */
export function DocumentForm({ spec, doc, onChange }: Props) {
  useLang()
  const set = <K extends keyof Doc>(key: K, value: Doc[K]) => onChange({ ...doc, [key]: value })
  const setRecipient = (key: keyof Doc['recipient'], value: string) =>
    onChange({ ...doc, recipient: { ...doc.recipient, [key]: value } })

  return (
    <div className="form">
      <section className="form-section">
        <h3>{spec.label}</h3>
        {!spec.letter && (
          <TextField field="number" label={spec.numberLabel ?? tr('Nummer', 'Number')} value={doc.number} onChange={(v) => set('number', v)} />
        )}
        <TextField field="date" label={spec.dateLabel} type="date" value={doc.date} onChange={(v) => set('date', v)} />
        {spec.reference && (
          <TextField
            field="reference"
            label={spec.reference.label}
            hint={spec.reference.hint}
            value={doc.reference}
            onChange={(v) => set('reference', v)}
          />
        )}
        {spec.referenceDate && (
          <TextField field="referenceDate" label={spec.referenceDate} type="date" value={doc.referenceDate} onChange={(v) => set('referenceDate', v)} />
        )}
        {spec.validUntil && (
          <TextField field="validUntil" label={spec.validUntil} type="date" value={doc.validUntil} onChange={(v) => set('validUntil', v)} />
        )}
        {spec.deliveryDate && (
          <TextField field="deliveryDate" label={spec.deliveryDate} type="date" value={doc.deliveryDate} onChange={(v) => set('deliveryDate', v)} />
        )}
      </section>

      <section className="form-section">
        <h3>{tr('Empfänger', 'Recipient')}</h3>
        <TextField field="recipient.name" label={tr('Name', 'Name')} value={doc.recipient.name} onChange={(v) => setRecipient('name', v)} />
        <TextField field="recipient.address" label={tr('Straße / Hausnummer', 'Street / house number')} value={doc.recipient.address} onChange={(v) => setRecipient('address', v)} />
        <TextField field="recipient.city" label={tr('PLZ / Ort', 'Postcode / city')} value={doc.recipient.city} onChange={(v) => setRecipient('city', v)} />
        {spec.einvoice && (
          <>
            <TextField field="recipient.vatId" label={tr('USt-IdNr. (E-Rechnung)', 'VAT ID (e-invoice)')} value={doc.recipient.vatId ?? ''} onChange={(v) => setRecipient('vatId', v)} />
            <TextField field="recipient.email" label={tr('E-Mail (E-Rechnung)', 'E-mail (e-invoice)')} value={doc.recipient.email ?? ''} onChange={(v) => setRecipient('email', v)} />
            <TextField field="recipient.buyerReference" label={tr('Leitweg-ID / Käuferreferenz', 'Leitweg ID / buyer reference')} value={doc.recipient.buyerReference ?? ''} onChange={(v) => setRecipient('buyerReference', v)} />
          </>
        )}
      </section>

      {spec.letter && (
        <section className="form-section">
          <h3>{tr('Inhalt', 'Content')}</h3>
          <TextField field="subject" label={tr('Betreff', 'Subject')} value={doc.subject} onChange={(v) => set('subject', v)} />
          <TextAreaField field="body" label={tr('Text', 'Text')} rows={14} value={doc.body} onChange={(v) => set('body', v)} />
        </section>
      )}

      {spec.reason && (
        <section className="form-section">
          <h3>{spec.reason}</h3>
          <TextAreaField field="reason" label={tr('Begründung (optional)', 'Reason (optional)')} value={doc.reason} onChange={(v) => set('reason', v)} />
        </section>
      )}

      {spec.items !== 'none' && (
        <ItemsEditor
          items={doc.items}
          onChange={(items) => set('items', items)}
          prices={spec.items === 'priced'}
          hint={spec.itemsHint}
        />
      )}

      {(spec.intro !== undefined || spec.closing !== undefined) && (
        <section className="form-section">
          <h3>{tr('Texte', 'Texts')}</h3>
          {spec.intro !== undefined && (
            <TextAreaField field="intro" label={tr('Einleitung', 'Introduction')} value={doc.intro} onChange={(v) => set('intro', v)} />
          )}
          {spec.closing !== undefined && (
            <TextAreaField field="closing" label={spec.letter ? tr('Grußformel', 'Closing phrase') : tr('Schlusstext', 'Closing text')} value={doc.closing} onChange={(v) => set('closing', v)} />
          )}
        </section>
      )}
    </div>
  )
}
