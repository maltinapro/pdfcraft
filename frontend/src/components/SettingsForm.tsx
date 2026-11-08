import { useState } from 'react'
import { Field, TextAreaField, TextField } from './Field'
import { useFieldProps } from './FormIssues'
import { tr, useLang } from '../lib/i18n'
import {
  FONTS,
  EINVOICE_PROFILES,
  LOCALES,
  MAX_LOGO_BYTES,
  type Bank,
  type Logo,
  type Sender,
  type Settings,
} from '../lib/types'

interface Props {
  settings: Settings
  onChange: (settings: Settings) => void
  /** Bank details, intro/closing text and e-invoice options only apply to invoices. */
  forInvoice?: boolean
}

const ACCEPTED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml']
const ACCEPTED_SIGNATURE_TYPES = [...ACCEPTED_LOGO_TYPES, 'application/pdf']

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function SettingsForm({ settings, onChange, forInvoice = true }: Props) {
  useLang()
  const [logoError, setLogoError] = useState<string | null>(null)
  const [signatureError, setSignatureError] = useState<string | null>(null)
  const paymentProps = useFieldProps('settings.paymentDays')

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value })
  const setSender = (key: keyof Sender, value: string) =>
    set('sender', { ...settings.sender, [key]: value })
  const setBank = (key: keyof Bank, value: string) =>
    set('bank', { ...settings.bank, [key]: value })

  const pickFile = async (
    file: File | undefined,
    accepted: string[],
    onError: (message: string | null) => void,
    what: { de: string; en: string; typesDe: string; typesEn: string },
  ): Promise<Logo | null> => {
    onError(null)
    if (!file) return null
    if (!accepted.includes(file.type)) {
      onError(tr(`Nur ${what.typesDe} erlaubt.`, `Only ${what.typesEn} allowed.`))
      return null
    }
    if (file.size > MAX_LOGO_BYTES) {
      onError(tr(`${what.de} darf maximal ${MAX_LOGO_BYTES / 1024} KB groß sein.`, `The ${what.en} must not exceed ${MAX_LOGO_BYTES / 1024} KB.`))
      return null
    }
    return { fileName: file.name, mimeType: file.type, base64: await readFileAsBase64(file) }
  }

  const onLogoSelected = async (file: File | undefined) => {
    const logo = await pickFile(file, ACCEPTED_LOGO_TYPES, setLogoError, {
      de: 'Das Logo',
      en: 'logo',
      typesDe: 'PNG, JPEG oder SVG',
      typesEn: 'PNG, JPEG or SVG',
    })
    if (logo) set('logo', logo)
  }

  const onSignatureSelected = async (file: File | undefined) => {
    const signature = await pickFile(file, ACCEPTED_SIGNATURE_TYPES, setSignatureError, {
      de: 'Die Unterschrift',
      en: 'signature',
      typesDe: 'PNG, JPEG, SVG oder PDF',
      typesEn: 'PNG, JPEG, SVG or PDF',
    })
    if (signature) set('signature', signature)
  }

  return (
    <div className="form">
      <section className="form-section">
        <h3>Logo</h3>
        {settings.logo ? (
          <div className="logo-preview">
            <img src={`data:${settings.logo.mimeType};base64,${settings.logo.base64}`} alt={tr('Logo', 'Logo')} />
            <span>{settings.logo.fileName}</span>
            <button type="button" className="btn btn-small" onClick={() => set('logo', null)}>
              {tr('Entfernen', 'Remove')}
            </button>
          </div>
        ) : (
          <label className="logo-upload">
            <span className="btn">{tr('Logo auswählen …', 'Choose logo …')}</span>
            <input
              type="file"
              hidden
              accept={ACCEPTED_LOGO_TYPES.join(',')}
              onChange={(e) => {
                void onLogoSelected(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <span className="field-hint">
              {tr(`PNG, JPG oder SVG, höchstens ${MAX_LOGO_BYTES / 1024} KB. Erscheint oben auf jedem Dokument.`, `PNG, JPG or SVG, at most ${MAX_LOGO_BYTES / 1024} KB. Shown at the top of every document.`)}
            </span>
          </label>
        )}
        {logoError && <p className="form-error">{logoError}</p>}
      </section>

      <section className="form-section">
        <h3>{tr('Unterschrift', 'Signature')}</h3>
        {settings.signature ? (
          <div className="logo-preview">
            {settings.signature.mimeType === 'application/pdf' ? (
              <span className="file-badge">PDF</span>
            ) : (
              <img src={`data:${settings.signature.mimeType};base64,${settings.signature.base64}`} alt={tr('Unterschrift', 'Signature')} />
            )}
            <span>{settings.signature.fileName}</span>
            <button type="button" className="btn btn-small" onClick={() => set('signature', null)}>
              {tr('Entfernen', 'Remove')}
            </button>
          </div>
        ) : (
          <label className="logo-upload">
            <span className="btn">{tr('Unterschrift auswählen …', 'Choose signature …')}</span>
            <input
              type="file"
              hidden
              accept={ACCEPTED_SIGNATURE_TYPES.join(',')}
              onChange={(e) => {
                void onSignatureSelected(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <span className="field-hint">
              {tr(
                `Eingescannte Unterschrift als PNG, JPG, SVG oder PDF (erste Seite, wird zugeschnitten), höchstens ${MAX_LOGO_BYTES / 1024} KB. Wird unter dem Schlusstext gedruckt. Das ist ein Bild und keine digitale Signatur.`,
                `Scanned signature as PNG, JPG, SVG or PDF (first page, cropped automatically), at most ${MAX_LOGO_BYTES / 1024} KB. Printed below the closing text. This is an image, not a digital signature.`,
              )}
            </span>
          </label>
        )}
        {signatureError && <p className="form-error">{signatureError}</p>}
      </section>

      <section className="form-section">
        <h3>{tr('Firma', 'Company')}</h3>
        <TextField field="settings.sender.name" label={tr('Name', 'Name')} value={settings.sender.name} onChange={(v) => setSender('name', v)} />
        <TextField field="settings.sender.address" label={tr('Straße / Hausnummer', 'Street / house number')} value={settings.sender.address} onChange={(v) => setSender('address', v)} />
        <TextField field="settings.sender.city" label={tr('PLZ / Ort', 'Postcode / city')} value={settings.sender.city} onChange={(v) => setSender('city', v)} />
        <TextField field="settings.sender.email" label={tr('E-Mail', 'E-mail')} type="email" value={settings.sender.email} onChange={(v) => setSender('email', v)} />
        <TextField
          field="settings.sender.contactName"
          label={tr('Ansprechpartner', 'Contact person')}
          value={settings.sender.contactName}
          onChange={(v) => setSender('contactName', v)}
          hint={tr('Für XRechnung Pflicht (zusammen mit Telefon).', 'Required for XRechnung (together with phone).')}
        />
        <TextField field="settings.sender.phone" label={tr('Telefon', 'Phone')} value={settings.sender.phone} onChange={(v) => setSender('phone', v)} />
        <TextField
          field="settings.sender.taxNr"
          label={tr('Steuernummer', 'Tax number')}
          value={settings.sender.taxNr}
          onChange={(v) => setSender('taxNr', v)}
          hint={tr('Auf einer Rechnung muss Ihre Steuernummer oder USt-IdNr. stehen – eine von beiden genügt.', 'An invoice must show your tax number or VAT ID – one of the two is enough.')}
        />
        <TextField
          field="settings.sender.vatId"
          label={tr('USt-IdNr.', 'VAT ID')}
          value={settings.sender.vatId}
          onChange={(v) => setSender('vatId', v)}
          hint={tr('Beginnt mit „DE“, falls Sie eine haben.', 'Starts with “DE” if you have one.')}
        />
      </section>

      {forInvoice && (
        <section className="form-section">
          <h3>{tr('Bankverbindung', 'Bank details')}</h3>
          <TextField field="settings.bank.name" label={tr('Bank', 'Bank')} value={settings.bank.name} onChange={(v) => setBank('name', v)} />
          <TextField field="settings.bank.iban" label="IBAN" value={settings.bank.iban} onChange={(v) => setBank('iban', v)} />
          <TextField field="settings.bank.bic" label="BIC" value={settings.bank.bic} onChange={(v) => setBank('bic', v)} />
          <Field field="settings.paymentDays" label={tr('Zahlungsziel (Tage)', 'Payment term (days)')}>
            <input
              {...paymentProps}
              type="number"
              min={0}
              value={settings.paymentDays}
              onChange={(e) => set('paymentDays', Number(e.target.value))}
            />
          </Field>
          <TextField
            field="settings.exemptionReason"
            label={tr('Grund der Steuerbefreiung', 'Reason for tax exemption')}
            value={settings.exemptionReason}
            onChange={(v) => set('exemptionReason', v)}
            hint={tr('Wird für Positionen mit 0 % (steuerbefreit) ausgewiesen.', 'Shown for items with 0 % (tax exempt).')}
          />
        </section>
      )}

      <section className="form-section">
        <h3>{tr('Design', 'Design')}</h3>
        <Field label={tr('Akzentfarbe', 'Accent color')}>
          <input
            type="color"
            value={settings.accentColor}
            onChange={(e) => set('accentColor', e.target.value)}
          />
        </Field>
        <Field label={tr('Schriftart', 'Font')}>
          <select value={settings.font} onChange={(e) => set('font', e.target.value)}>
            {FONTS.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr('Dokumentsprache / Document language', 'Document language / Dokumentsprache')}>
          <select value={settings.locale} onChange={(e) => set('locale', e.target.value)}>
            {LOCALES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="form-section">
        <h3>{tr('Texte', 'Texts')}</h3>
        {forInvoice && (
          <>
            <TextAreaField field="settings.intro" label={tr('Einleitung', 'Introduction')} value={settings.intro} onChange={(v) => set('intro', v)} />
            <TextAreaField field="settings.closing" label={tr('Schlusstext', 'Closing text')} value={settings.closing} onChange={(v) => set('closing', v)} />
          </>
        )}
        <TextAreaField field="settings.footer" label={tr('Fußzeile', 'Footer')} value={settings.footer} onChange={(v) => set('footer', v)} rows={2} />
      </section>

      {forInvoice && (
        <section className="form-section">
          <h3>{tr('E-Rechnung', 'E-invoice')}</h3>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.zugferd}
              onChange={(e) => set('zugferd', e.target.checked)}
            />
            {tr('E-Rechnung (ZUGFeRD / Factur-X) einbetten', 'Embed e-invoice (ZUGFeRD / Factur-X)')}
          </label>
          <p className="field-hint">
            {tr(
              'Legt die Rechnungsdaten zusätzlich maschinenlesbar im PDF ab. Für Geschäftskunden wird das zunehmend vorgeschrieben, für Privatkunden ist es nicht nötig.',
              'Also stores the invoice data in machine-readable form inside the PDF. Increasingly required for business customers, not needed for private customers.',
            )}
          </p>
          {settings.zugferd && (
            <Field
              label={tr('Profil', 'Profile')}
              hint={tr('Im Zweifel „ZUGFeRD“. „XRechnung“ nur, wenn Ihr Kunde eine Behörde ist.', 'If in doubt choose “ZUGFeRD”. Choose “XRechnung” only if your customer is a public authority.')}
            >
              <select value={settings.einvoiceProfile} onChange={(e) => set('einvoiceProfile', e.target.value)}>
                {EINVOICE_PROFILES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </section>
      )}
    </div>
  )
}
