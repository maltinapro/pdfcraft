import { describe, expect, it } from 'vitest'
import { addIsoDays } from './types'

describe('addIsoDays', () => {
  it('handles month, year and leap-day boundaries using ISO dates', () => {
    expect(addIsoDays('2026-01-31', 14)).toBe('2026-02-14')
    expect(addIsoDays('2026-12-20', 14)).toBe('2027-01-03')
    expect(addIsoDays('2024-02-28', 1)).toBe('2024-02-29')
  })

  it('rejects invalid dates and non-integer offsets', () => {
    expect(addIsoDays('2026-02-30', 1)).toBe('')
    expect(addIsoDays('not-a-date', 1)).toBe('')
    expect(addIsoDays('2026-01-01', 1.5)).toBe('')
  })
})
