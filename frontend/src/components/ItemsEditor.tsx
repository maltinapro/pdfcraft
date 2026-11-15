import { useState } from 'react'
import { Field, TextField } from './Field'
import { errorId, useFieldIssue, useFieldPropsFor } from './FormIssues'
import { ArticlePicker, money } from './MasterDataPickers'
import { tr, useLang } from '../lib/i18n'
import { getMasterData, saveArticleFromItem, setMasterData } from '../lib/masterData'
import { TAX_RATES, UNITS, newItem, type InvoiceItem } from '../lib/types'

interface Props {
  items: InvoiceItem[]
  onChange: (items: InvoiceItem[]) => void
  /** Show unit price and tax rate; without them only quantity and unit are edited. */
  prices?: boolean
  negative?: boolean
  hint?: string
}

export function ItemsEditor({ items, onChange, prices = true, negative = false, hint }: Props) {
  useLang()
  const fieldProps = useFieldPropsFor()
  const listIssue = useFieldIssue('items')
  const setItem = (id: string, patch: Partial<InvoiceItem>) =>
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)))

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const moveItem = (from: number, to: number) => {
    if (from === to || to < 0 || to >= items.length) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }

  const endDrag = () => {
    setDragIndex(null)
    setOverIndex(null)
  }

  const [saved, setSaved] = useState<{ id: string; text: string; error?: boolean } | null>(null)
  const totals = prices
    ? items.reduce(
        (sum, item) => {
          const net = item.quantity * item.price * (negative ? -1 : 1)
          sum.net += net
          sum.taxes.set(item.taxRate, (sum.taxes.get(item.taxRate) ?? 0) + net * item.taxRate / 100)
          return sum
        },
        { net: 0, taxes: new Map<number, number>() },
      )
    : null

  const saveAsArticle = (item: InvoiceItem) => {
    const { data, updated } = saveArticleFromItem(getMasterData(), item)
    setSaved(
      setMasterData(data)
        ? { id: item.id, text: updated ? tr('Artikel aktualisiert.', 'Article updated.') : tr('Artikel gespeichert.', 'Article saved.') }
        : { id: item.id, text: tr('Speichern im Browser fehlgeschlagen (Speicher voll oder deaktiviert).', 'Saving in the browser failed (storage full or disabled).'), error: true },
    )
  }

  const removeItem = (id: string) => onChange(items.filter((item) => item.id !== id))

  return (
    <section className="form-section">
      <h3>{tr('Positionen', 'Items')}</h3>
      {hint && <p className="form-hint">{hint}</p>}
      {listIssue && (
        <p className="form-error" id={errorId('items')}>
          {listIssue.message}
        </p>
      )}
      {items.map((item, index) => (
        <div
          className={`item-card${dragIndex === index ? ' dragging' : ''}${
            overIndex === index && dragIndex !== null && dragIndex !== index ? ' drop-target' : ''
          }`}
          key={item.id}
          onDragOver={(e) => {
            if (dragIndex === null) return
            e.preventDefault()
            setOverIndex(index)
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (dragIndex !== null) moveItem(dragIndex, index)
            endDrag()
          }}
        >
          <div className="item-card-header">
            <span
              className="drag-handle"
              draggable
              title={tr('Zum Sortieren ziehen', 'Drag to reorder')}
              aria-label={tr('Position verschieben', 'Move item')}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                setDragIndex(index)
              }}
              onDragEnd={endDrag}
            >
              ⠿
            </span>
            <strong>{tr('Position', 'Item')} {index + 1}</strong>
            {prices && <span className="item-line-total">{money(item.quantity * item.price * (negative ? -1 : 1))}</span>}
            <span className="item-actions">
              <button
                type="button"
                className="btn btn-small"
                title={tr('Nach oben', 'Move up')}
                aria-label={tr('Position nach oben', 'Move item up')}
                disabled={index === 0}
                onClick={() => moveItem(index, index - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn-small"
                title={tr('Nach unten', 'Move down')}
                aria-label={tr('Position nach unten', 'Move item down')}
                disabled={index === items.length - 1}
                onClick={() => moveItem(index, index + 1)}
              >
                ↓
              </button>
              <button type="button" className="btn btn-small" onClick={() => removeItem(item.id)}>
                {tr('Entfernen', 'Remove')}
              </button>
            </span>
          </div>
          <TextField field={`items[${index}].description`} label={tr('Beschreibung', 'Description')} value={item.description} onChange={(v) => setItem(item.id, { description: v })} />
          <div className="item-row">
            <Field field={`items[${index}].quantity`} label={tr('Menge', 'Quantity')}>
              <input
                {...fieldProps(`items[${index}].quantity`)}
                type="number"
                min={0}
                step="any"
                value={item.quantity}
                onChange={(e) => setItem(item.id, { quantity: Number(e.target.value) })}
              />
            </Field>
            <Field field={`items[${index}].unit`} label={tr('Einheit', 'Unit')}>
              <select value={item.unit} onChange={(e) => setItem(item.id, { unit: e.target.value })}>
                {UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {prices && (
            <div className="item-row">
              <Field field={`items[${index}].price`} label={tr('Einzelpreis (netto)', 'Unit price (net)')}>
                <input
                  {...fieldProps(`items[${index}].price`)}
                  type="number"
                  step="0.01"
                  value={item.price}
                  onChange={(e) => setItem(item.id, { price: Number(e.target.value) })}
                />
              </Field>
              <Field label={tr('USt.', 'VAT')}>
                <select
                  value={item.taxRate}
                  onChange={(e) => setItem(item.id, { taxRate: Number(e.target.value) })}
                >
                  {TAX_RATES.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate === 0 ? tr('0 % (steuerbefreit)', '0 % (tax exempt)') : `${rate} %`}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          {prices && (
            <div className="item-save">
              <button type="button" className="btn btn-small" disabled={!item.description.trim()} onClick={() => saveAsArticle(item)}>
                {tr('Als Artikel speichern', 'Save as article')}
              </button>
              {saved?.id === item.id && (
                <span className={saved.error ? 'form-error' : 'form-hint'} role="status">
                  {saved.text}
                </span>
              )}
            </div>
          )}
        </div>
      ))}
      {totals && (
        <section className="items-totals" aria-label={tr('Summen', 'Totals')}>
          <div className="items-totals-row items-totals-subtotal">
            <strong>{tr('Zwischensumme netto', 'Subtotal net')}</strong>
            <span>{money(totals.net)}</span>
          </div>
          {[...totals.taxes.entries()].sort(([a], [b]) => b - a).map(([rate, amount]) => (
            <div className="items-totals-row" key={rate}>
              <span>{tr(`USt. ${rate} %`, `VAT ${rate} %`)}</span>
              <span>{money(amount)}</span>
            </div>
          ))}
          <div className="items-totals-row items-totals-grand">
            <strong>{tr('Gesamt', 'Total')}</strong>
            <strong>{money(totals.net + [...totals.taxes.values()].reduce((sum, amount) => sum + amount, 0))}</strong>
          </div>
        </section>
      )}
      <div className="items-add">
        <button
          type="button"
          className="btn"
          data-field="items"
          aria-describedby={listIssue ? errorId('items') : undefined}
          onClick={() => onChange([...items, newItem()])}
        >
          {tr('+ Position hinzufügen', '+ Add item')}
        </button>
        <ArticlePicker prices={prices} onAdd={(item) => onChange([...items, item])} />
      </div>
    </section>
  )
}
