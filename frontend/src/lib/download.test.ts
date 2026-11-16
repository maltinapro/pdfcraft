import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadBlob } from './download'

describe('downloadBlob', () => {
  const clicks: { href: string; download: string }[] = []
  const revoke = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    clicks.length = 0
    revoke.mockClear()
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: revoke })
    vi.stubGlobal('window', { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) })
    vi.stubGlobal('document', {
      createElement: () => {
        const link = {
          href: '',
          download: '',
          click() {
            clicks.push({ href: link.href, download: link.download })
          },
        }
        return link
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('clicks a link with the file name and revokes the URL only later', () => {
    downloadBlob(new Blob(['x']), 'a.pdf')
    expect(clicks).toEqual([{ href: 'blob:test', download: 'a.pdf' }])
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(revoke).toHaveBeenCalledWith('blob:test')
  })
})
