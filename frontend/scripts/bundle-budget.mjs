// Bundle budget (E12-03): fails when a built file grows past its limit. Run `npm run build` first.
// Sizes are the minified file sizes (kB, 1 kB = 1000 bytes); see docs/17-code-review.md "Bundle baseline".
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const assets = join(import.meta.dirname, '..', 'dist', 'assets')

const budgets = [
  { pattern: /^app-.*\.js$/, limitKb: 390 },
  { pattern: /^app-.*\.css$/, limitKb: 71.7 },
  { pattern: /^landing-.*\.css$/, limitKb: 25.3 },
  { pattern: /^pdf-.*\.js$/, limitKb: 550.1 },
  { pattern: /^ViewerPage-.*\.js$/, limitKb: 44.2 },
  { pattern: /^ViewerPage-.*\.css$/, limitKb: 10.6 },
]

let files
try {
  files = readdirSync(assets)
} catch {
  console.error(`No build output in ${assets}; run "npm run build" first.`)
  process.exit(2)
}

let failed = false
for (const { pattern, limitKb } of budgets) {
  const matches = files.filter((f) => pattern.test(f))
  if (matches.length === 0) {
    console.error(`FAIL  no built file matches ${pattern}`)
    failed = true
    continue
  }
  for (const file of matches) {
    const kb = statSync(join(assets, file)).size / 1000
    const over = kb > limitKb
    console.log(`${over ? 'FAIL' : 'ok  '}  ${file}  ${kb.toFixed(2)} kB (limit ${limitKb} kB)`)
    if (over) failed = true
  }
}
process.exit(failed ? 1 : 0)
