import { createContext, useContext } from 'react'
import type { Issue } from '../lib/validate'

export interface FormIssuesValue {
  /** The visible issue of a field (touched, reported by the backend or after a download attempt). */
  issue: (field: string) => Issue | undefined
  /** Marks a field as visited so its problem is shown from now on. */
  touch: (field: string) => void
}

export const FormIssuesContext = createContext<FormIssuesValue>({ issue: () => undefined, touch: () => {} })

export function useFieldIssue(field?: string): Issue | undefined {
  const ctx = useContext(FormIssuesContext)
  return field ? ctx.issue(field) : undefined
}

export const errorId = (field: string) => `err-${field.replace(/[^a-zA-Z0-9]+/g, '-')}`

/** Returns a function building the props of a field's input (jump target, `aria-invalid`, link to the message, touch on blur). */
export function useFieldPropsFor() {
  const ctx = useContext(FormIssuesContext)
  return (field?: string) => {
    if (!field) return {}
    const issue = ctx.issue(field)
    return {
      'data-field': field,
      'aria-invalid': issue?.level === 'error' ? (true as const) : undefined,
      'aria-describedby': issue ? errorId(field) : undefined,
      onBlur: () => ctx.touch(field),
    }
  }
}

export function useFieldProps(field?: string) {
  return useFieldPropsFor()(field)
}
