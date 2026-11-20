import { describe, expect, it } from 'vitest'
import { friendlyError } from './apiErrors'

describe('friendlyError', () => {
  it.each(['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.'])('translates the raw browser message %s', (raw) => {
    expect(friendlyError(new TypeError(raw))).toMatch(/server/i)
    expect(friendlyError(new TypeError(raw))).not.toBe(raw)
  })

  it('keeps messages that are already readable', () => {
    expect(friendlyError(new Error('Dieses Token ist abgelaufen.'))).toBe('Dieses Token ist abgelaufen.')
    expect(friendlyError('plain text')).toBe('plain text')
  })
})
