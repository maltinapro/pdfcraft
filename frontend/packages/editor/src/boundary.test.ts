import { describe, expect, it } from 'vitest'

// The package must not depend on the host app: relative imports stay inside `src/`, bare imports are limited to
// the declared dependencies, and the browser storage and the network belong to the host (adapter), not to the editor.
const PEERS = ['react', 'react-dom', 'pdfjs-dist', '@pdfcraft/design']

const sources = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true })

/** Resolves `specifier` against the importing file; `null` when it leaves `src/`. */
function resolveInside(file: string, specifier: string): string | null {
  const parts = file.split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.') parts.push(part)
  }
  return parts[0] === '.' ? parts.join('/') : null
}

describe('@pdfcraft/editor package boundary', () => {
  it('finds the package sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20)
  })

  it('imports nothing from outside the package except its peer dependencies', () => {
    const offenders: string[] = []
    for (const [file, code] of Object.entries(sources)) {
      for (const [, a, b, c] of code.matchAll(/^(?:import|export)\s[^;'"]*?from\s*'([^']+)'|^import\s*'([^']+)'|\bimport\('([^']+)'\)/gm)) {
        const specifier = a ?? b ?? c
        if (specifier.startsWith('.')) {
          if (!resolveInside(file, specifier)) offenders.push(`${file}: ${specifier}`)
        } else if (!PEERS.some((peer) => specifier === peer || specifier.startsWith(`${peer}/`))) {
          offenders.push(`${file}: ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('does not touch the browser storage or the network itself', () => {
    const offenders = Object.entries(sources)
      .filter(([, code]) => /\b(localStorage|sessionStorage|indexedDB)\b|\bfetch\(/.test(code))
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })
})
