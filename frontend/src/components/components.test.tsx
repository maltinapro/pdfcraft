import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FormIssuesContext, errorId, type FormIssuesValue } from './FormIssues'
import { SelectField, TextField } from './ui/Field'
import { Stepper } from './editor/Stepper'
import { IssueSummary, PreviewPaused } from './workspace/IssueSummary'
import { ZONES } from '../lib/documents'
import { setLang } from '../lib/i18n'
import type { Issue } from '../lib/validate'

function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  }
}

const error: Issue = { level: 'error', field: 'recipient.name', message: 'Name fehlt', blocking: true }

function withIssues(issues: Issue[], node: ReturnType<typeof createElement>) {
  const value: FormIssuesValue = { issue: (field) => issues.find((issue) => issue.field === field), touch: () => {} }
  return renderToStaticMarkup(createElement(FormIssuesContext.Provider, { value }, node))
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage())
  setLang('en')
})

describe('Field components', () => {
  it('render without a field key and without an issue', () => {
    const html = renderToStaticMarkup(createElement(TextField, { label: 'Name', value: 'A', onChange: () => {} }))
    expect(html).toContain('field-label')
    expect(html).not.toContain('field-invalid')
    expect(html).not.toContain('data-field')
  })

  it('mark the input invalid and link it to the message', () => {
    const html = withIssues([error], createElement(TextField, { label: 'Name', value: '', onChange: () => {}, field: 'recipient.name' }))
    expect(html).toContain('field-invalid')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('data-field="recipient.name"')
    expect(html).toContain(`aria-describedby="${errorId('recipient.name')}"`)
    expect(html).toContain(`id="${errorId('recipient.name')}"`)
    expect(html).toContain('Name fehlt')
  })

  it('show warnings without aria-invalid', () => {
    const warning: Issue = { level: 'warning', field: 'settings.bank.iban', message: 'Prüfen' }
    const html = withIssues([warning], createElement(SelectField, { label: 'Bank', value: 'a', onChange: () => {}, options: [{ value: 'a', label: 'A' }], field: 'settings.bank.iban' }))
    expect(html).toContain('field-warn')
    expect(html).not.toContain('aria-invalid')
  })

  it('build stable ids from field paths', () => {
    expect(errorId('items[0].price')).toBe('err-items-0-price')
  })
})

describe('IssueSummary', () => {
  it('counts errors, and links issues with a field', () => {
    const html = renderToStaticMarkup(createElement(IssueSummary, { issues: [error], kind: 'invoice', onJump: () => {}, open: false }))
    expect(html).toContain('1 entry needs attention')
    expect(html).toContain('issue-link')
    expect(html).not.toContain('notes-only')
  })

  it('shows notes only when there is no error', () => {
    const notes: Issue[] = [
      { level: 'warning', message: 'a' },
      { level: 'warning', message: 'b' },
    ]
    const html = renderToStaticMarkup(createElement(IssueSummary, { issues: notes, kind: 'invoice', onJump: () => {}, open: true }))
    expect(html).toContain('2 notes')
    expect(html).toContain('notes-only')
    expect(html).not.toContain('issue-link')
  })

  it('announces a paused preview with the count', () => {
    expect(renderToStaticMarkup(createElement(PreviewPaused, { count: 3, onShow: () => {} }))).toContain('3 entries are missing or invalid')
  })
})

describe('Stepper', () => {
  it('labels every step with its state and marks the active one', () => {
    const zones = ZONES.invoice
    const states = Object.fromEntries(zones.map((zone, i) => [zone.id, i === 0 ? { status: 'errors', count: 2 } : { status: 'untouched' }])) as never
    const html = renderToStaticMarkup(createElement(Stepper, { zones, active: zones[1].id, states, onSelect: () => {} }))
    expect(html).toContain('2 errors')
    expect(html).toContain('Not visited')
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(html.match(/role="tab"/g)).toHaveLength(zones.length)
  })
})
