import type { ButtonHTMLAttributes, HTMLAttributes } from 'react'

interface Props extends HTMLAttributes<HTMLSpanElement> {
  kind?: 'assist' | 'status'
}

export function Chip({ kind = 'assist', className = '', ...props }: Props) {
  return <span {...props} className={`ui-chip ui-chip-${kind}${className ? ` ${className}` : ''}`} />
}

interface FilterProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean
}

export function FilterChip({ selected = false, className = '', ...props }: FilterProps) {
  return <button {...props} type="button" aria-pressed={selected} className={`ui-chip ui-chip-filter${className ? ` ${className}` : ''}`} />
}
