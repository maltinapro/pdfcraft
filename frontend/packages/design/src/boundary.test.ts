import { describe, expect, it } from 'vitest'

// The design package must not depend on the app or on the editor: relative imports stay inside `src/` and the only
// bare import is React. The browser storage is reserved for the theme preference (theme.ts); there is no network access.
const sources = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true })

function resolveInside(file: string, specifier: string): string | null {
  const parts = file.split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.') parts.push(part)
  }
  return parts[0] === '.' ? parts.join('/') : null
}

describe('@maltinapro/pdfcraft-design package boundary', () => {
  it('finds the package sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10)
  })

  it('imports nothing from outside the package except react', () => {
    const offenders: string[] = []
    for (const [file, code] of Object.entries(sources)) {
      for (const [, a, b, c] of code.matchAll(/^(?:import|export)\s[^;'"]*?from\s*'([^']+)'|^import\s*'([^']+)'|\bimport\('([^']+)'\)/gm)) {
        const specifier = a ?? b ?? c
        if (specifier.startsWith('.')) {
          if (!resolveInside(file, specifier)) offenders.push(`${file}: ${specifier}`)
        } else if (specifier !== 'react' && specifier !== 'react-dom') {
          offenders.push(`${file}: ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('uses browser storage only in theme.ts and never the network', () => {
    const storage = Object.entries(sources)
      .filter(([, code]) => /\b(localStorage|sessionStorage|indexedDB)\b/.test(code))
      .map(([file]) => file)
    expect(storage).toEqual(['./theme.ts'])
    expect(Object.entries(sources).filter(([, code]) => /\bfetch\(/.test(code))).toEqual([])
  })
})
