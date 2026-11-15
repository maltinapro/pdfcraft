import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')

function declarations(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]))
}

function resolve(name: string, vars: Record<string, string>, depth = 0): string {
  if (depth > 4) throw new Error(`Token cycle at ${name}`)
  const value = vars[name]
  if (!value) throw new Error(`Missing token ${name}`)
  const reference = value.match(/^var\((--[\w-]+)\)$/)
  return reference ? resolve(reference[1], vars, depth + 1) : value
}

function luminance(color: string) {
  const channels = color.match(/[0-9A-F]{2}/gi)?.map((part) => parseInt(part, 16) / 255)
  if (!channels || channels.length !== 3) throw new Error(`Expected hex color, got ${color}`)
  const linear = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

function contrast(foreground: string, background: string) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

const textPairs: [string, string][] = [
  ['--color-on-primary', '--color-primary'],
  ['--color-on-primary-container', '--color-primary-container'],
  ['--color-on-surface', '--color-surface'],
  ['--color-on-surface-variant', '--color-surface'],
  ['--color-on-surface-variant', '--color-surface-container-low'],
  ['--color-on-surface-variant', '--color-surface-container'],
  ['--color-on-surface-variant', '--color-surface-container-high'],
  ['--color-on-surface-variant', '--color-surface-container-highest'],
  ['--color-on-error', '--color-error'],
  ['--color-on-error-container', '--color-error-container'],
  ['--color-on-warning-container', '--color-warning-container'],
  ['--color-warning', '--color-surface'],
  ['--color-success', '--color-surface'],
  ['--zone-sender-on-container', '--zone-sender-container'],
  ['--zone-recipient-on-container', '--zone-recipient-container'],
  ['--zone-details-on-container', '--zone-details-container'],
  ['--zone-items-on-container', '--zone-items-container'],
  ['--zone-sender', '--color-surface'],
  ['--zone-recipient', '--color-surface'],
  ['--zone-details', '--color-surface'],
  ['--zone-items', '--color-surface'],
]

describe('design tokens', () => {
  it('defines light and dark schemes with AA text contrast and usable UI boundaries', () => {
    const themes = [declarations(':root'), { ...declarations(':root'), ...declarations(":root[data-theme='dark']") }]
    for (const [themeIndex, vars] of themes.entries()) {
      for (const [foreground, background] of textPairs) {
        const ratio = contrast(resolve(foreground, vars), resolve(background, vars))
        expect(ratio, `theme ${themeIndex}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrast(resolve('--color-outline', vars), resolve('--color-surface-container-highest', vars))).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps high-contrast variants at AA for text and UI boundaries', () => {
    const light = { ...declarations(':root'), '--color-on-surface-variant': '#000000', '--color-outline': '#2D2A38', '--color-primary': '#2C008F' }
    const dark = {
      ...declarations(':root'),
      ...declarations(":root[data-theme='dark']"),
      '--color-on-surface-variant': '#FFFFFF',
      '--color-outline': '#F3EDFF',
      '--color-primary': '#F3EDFF',
    }
    for (const vars of [light, dark]) {
      for (const [foreground, background] of textPairs) {
        expect(contrast(resolve(foreground, vars), resolve(background, vars)), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrast(resolve('--color-outline', vars), resolve('--color-surface-container-highest', vars))).toBeGreaterThanOrEqual(3)
    }
  })

  it('includes forced-color borders and focus outlines', () => {
    expect(css).toContain('@media (forced-colors: active)')
    expect(css).toContain('outline: 2px solid Highlight')
    expect(css).toContain('border: 1px solid transparent')
  })
})
