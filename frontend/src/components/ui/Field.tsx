import type { ReactNode } from 'react'
import { errorId, useFieldIssue, useFieldProps } from '../FormIssues'

interface FieldProps {
  label: string
  children: ReactNode
  hint?: string
  field?: string
}

export function Field({ label, children, hint, field }: FieldProps) {
  const issue = useFieldIssue(field)
  return (
    <label className={`field${issue ? ` field-${issue.level === 'error' ? 'invalid' : 'warn'}` : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {issue && field && <span className="field-message" id={errorId(field)}>{issue.message}</span>}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

interface TextFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  type?: 'text' | 'email' | 'date'
  placeholder?: string
  field?: string
}

export function TextField({ label, value, onChange, hint, type = 'text', placeholder, field }: TextFieldProps) {
  const props = useFieldProps(field)
  return (
    <Field label={label} hint={hint} field={field}>
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} {...props} />
    </Field>
  )
}

interface SelectFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  hint?: string
  field?: string
}

export function SelectField({ label, value, onChange, options, hint, field }: SelectFieldProps) {
  const props = useFieldProps(field)
  return (
    <Field label={label} hint={hint} field={field}>
      <select value={value} onChange={(e) => onChange(e.target.value)} {...props}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </Field>
  )
}

interface TextAreaFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  rows?: number
  field?: string
  hint?: string
}

export function TextAreaField({ label, value, onChange, rows = 3, field, hint }: TextAreaFieldProps) {
  const props = useFieldProps(field)
  return (
    <Field label={label} hint={hint} field={field}>
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} {...props} />
    </Field>
  )
}
