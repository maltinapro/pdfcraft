import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runChecks, NOT_CHECKED } from './check'
import { parseEInvoice } from './parse'
import { setLang } from '../i18n'

// Golden files shared with the backend (`backend/src/einvoice_parse/tests.rs`, `POST /v1/einvoices/parse`):
// both implementations must produce exactly these views and plausibility checks for the same file.
// Regenerate after an intended change with `npx vitest run golden -u` and commit the files.
const xmlFiles = import.meta.glob<string>('./testdata/*.xml', { query: '?raw', import: 'default', eager: true })

const snapshot = (xml: string) => {
  const view = parseEInvoice(xml)
  const checks: Record<string, unknown> = {}
  for (const lang of ['de', 'en'] as const) {
    setLang(lang)
    checks[lang] = { checks: runChecks(view), notChecked: NOT_CHECKED() }
  }
  return JSON.parse(JSON.stringify({ view, ...checks }))
}

describe('golden files shared with the backend', () => {
  beforeAll(() => {
    vi.stubGlobal('document', { documentElement: {} })
    vi.stubGlobal('localStorage', { setItem: () => undefined, getItem: () => null })
  })
  afterAll(() => vi.unstubAllGlobals())

  for (const [path, xml] of Object.entries(xmlFiles)) {
    const name = path.replace('./testdata/', '')
    it(`${name} gives the recorded view and checks`, async () => {
      const actual = JSON.stringify(snapshot(xml), null, 2) + '\n'
      await expect(actual).toMatchFileSnapshot(`./testdata/expected/${name.replace(/\.xml$/, '.json')}`)
    })
  }
})
