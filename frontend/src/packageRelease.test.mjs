import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const design = JSON.parse(read('../packages/design/package.json'))
const editor = JSON.parse(read('../packages/editor/package.json'))
const app = JSON.parse(read('../package.json'))

describe('GitHub Packages release configuration', () => {
  it('uses the repository owner as the package and workflow scope', () => {
    for (const [kind, pkg] of Object.entries({ design, editor })) {
      const owner = new URL(pkg.repository.url.replace(/^git\+/, '')).pathname.split('/')[1]
      expect(pkg.name).toBe(`@${owner}/${kind}`)
      expect(pkg.publishConfig.registry).toBe('https://npm.pkg.github.com')
      expect(read(`../../.github/workflows/release-${kind}-package.yml`)).toContain(`scope: "@${owner}"`)
    }
    expect(editor.dependencies[design.name]).toBeDefined()
    expect(app.dependencies[editor.name]).toBeDefined()
  })
})
