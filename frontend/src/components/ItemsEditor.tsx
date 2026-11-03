import { useState } from 'react'
import { Field, TextField } from './Field'
import { TAX_RATES, UNITS, newItem, type InvoiceItem } from '../lib/types'

interface Props {
  items: InvoiceItem[]
  onChange: (items: InvoiceItem[]) => void
  /** Show unit price and tax rate; without them only quantity and unit are edited. */
  prices?: boolean
  hint?: string
}

export function ItemsEditor({ items, onChange, prices = true, hint }: Props) {
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

  const removeItem = (id: string) => onChange(items.filter((item) => item.id !== id))

  return (
    <section className="form-section">
      <h3>Positionen</h3>
      {hint && <p className="form-hint">{hint}</p>}
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
              title="Zum Sortieren ziehen"
              aria-label="Position verschieben"
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                setDragIndex(index)
              }}
              onDragEnd={endDrag}
            >
              ⠿
            </span>
            <strong>Position {index + 1}</strong>
            <span className="item-actions">
              <button
                type="button"
                className="btn btn-small"
                title="Nach oben"
                aria-label="Position nach oben"
                disabled={index === 0}
                onClick={() => moveItem(index, index - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn-small"
                title="Nach unten"
                aria-label="Position nach unten"
                disabled={index === items.length - 1}
                onClick={() => moveItem(index, index + 1)}
              >
                ↓
              </button>
              <button type="button" className="btn btn-small" onClick={() => removeItem(item.id)}>
                Entfernen
              </button>
            </span>
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
          {prices && (
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
                      {rate === 0 ? '0 % (steuerbefreit)' : `${rate} %`}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() => onChange([...items, newItem()])}
      >
        + Position hinzufügen
      </button>
    </section>
  )
}
