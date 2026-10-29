import { useState } from 'react'
import { Field, TextAreaField, TextField } from './Field'
import {
  FONTS,
  LOCALES,
  MAX_LOGO_BYTES,
  type Bank,
  type Sender,
  type Settings,
} from '../lib/types'

interface Props {
  settings: Settings
  onChange: (settings: Settings) => void
}

const ACCEPTED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml']

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function SettingsForm({ settings, onChange }: Props) {
  const [logoError, setLogoError] = useState<string | null>(null)

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value })
  const setSender = (key: keyof Sender, value: string) =>
    set('sender', { ...settings.sender, [key]: value })
  const setBank = (key: keyof Bank, value: string) =>
    set('bank', { ...settings.bank, [key]: value })

  const onLogoSelected = async (file: File | undefined) => {
    setLogoError(null)
    if (!file) return
    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      setLogoError('Nur PNG, JPEG oder SVG erlaubt.')
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(`Das Logo darf maximal ${MAX_LOGO_BYTES / 1024} KB groß sein.`)
      return
    }
    set('logo', {
      fileName: file.name,
      mimeType: file.type,
      base64: await readFileAsBase64(file),
    })
  }

  return (
    <div className="form">
      <section className="form-section">
        <h3>Logo</h3>
        {settings.logo ? (
          <div className="logo-preview">
            <img src={`data:${settings.logo.mimeType};base64,${settings.logo.base64}`} alt="Logo" />
            <span>{settings.logo.fileName}</span>
            <button type="button" className="btn btn-small" onClick={() => set('logo', null)}>
              Entfernen
            </button>
          </div>
        ) : (
          <input
            type="file"
            accept={ACCEPTED_LOGO_TYPES.join(',')}
            onChange={(e) => void onLogoSelected(e.target.files?.[0])}
          />
        )}
        {logoError && <p className="form-error">{logoError}</p>}
      </section>

      <section className="form-section">
        <h3>Firma</h3>
        <TextField label="Name" value={settings.sender.name} onChange={(v) => setSender('name', v)} />
        <TextField label="Straße / Hausnummer" value={settings.sender.address} onChange={(v) => setSender('address', v)} />
        <TextField label="PLZ / Ort" value={settings.sender.city} onChange={(v) => setSender('city', v)} />
        <TextField label="E-Mail" type="email" value={settings.sender.email} onChange={(v) => setSender('email', v)} />
        <TextField label="Telefon" value={settings.sender.phone} onChange={(v) => setSender('phone', v)} />
        <TextField label="Steuernummer" value={settings.sender.taxNr} onChange={(v) => setSender('taxNr', v)} />
        <TextField label="USt-IdNr." value={settings.sender.vatId} onChange={(v) => setSender('vatId', v)} />
      </section>

      <section className="form-section">
        <h3>Bankverbindung</h3>
        <TextField label="Bank" value={settings.bank.name} onChange={(v) => setBank('name', v)} />
        <TextField label="IBAN" value={settings.bank.iban} onChange={(v) => setBank('iban', v)} />
        <TextField label="BIC" value={settings.bank.bic} onChange={(v) => setBank('bic', v)} />
        <Field label="Zahlungsziel (Tage)">
          <input
            type="number"
            min={0}
            value={settings.paymentDays}
            onChange={(e) => set('paymentDays', Number(e.target.value))}
          />
        </Field>
      </section>

      <section className="form-section">
        <h3>Design</h3>
        <Field label="Akzentfarbe">
          <input
            type="color"
            value={settings.accentColor}
            onChange={(e) => set('accentColor', e.target.value)}
          />
        </Field>
        <Field label="Schriftart">
          <select value={settings.font} onChange={(e) => set('font', e.target.value)}>
            {FONTS.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sprache der Rechnung">
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
        <h3>Texte</h3>
        <TextAreaField label="Einleitung" value={settings.intro} onChange={(v) => set('intro', v)} />
        <TextAreaField label="Schlusstext" value={settings.closing} onChange={(v) => set('closing', v)} />
        <TextAreaField label="Fußzeile" value={settings.footer} onChange={(v) => set('footer', v)} rows={2} />
      </section>

      <section className="form-section">
        <h3>E-Rechnung</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.zugferd}
            onChange={(e) => set('zugferd', e.target.checked)}
          />
          ZUGFeRD / Factur-X einbetten (experimentell)
        </label>
      </section>
    </div>
  )
}
