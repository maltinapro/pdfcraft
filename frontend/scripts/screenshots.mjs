import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const option = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? fallback : process.argv[index + 1]
}
const output = resolve(option('--out', '/tmp/pdfcraft-screenshots'))
const widths = [320, 390, 768, 1440]
const routes = ['', 'invoice', 'credit-note', 'offer', 'order', 'delivery-note', 'letter', 'sender', 'documents', 'contacts', 'articles', 'more', 'viewer', 'data', 'buy']

const archive = [
  {
    id: 'screenshot-invoice',
    kind: 'invoice',
    number: '2026-001',
    date: '2026-11-01',
    recipient: 'Beispielkunde GmbH',
    total: 226,
    issuedAt: '2026-11-01T10:00:00.000Z',
    invoice: {
      number: '2026-001',
      date: '2026-11-01',
      recipient: { name: 'Beispielkunde GmbH', address: 'Beispielstraße 1', city: '10115 Berlin' },
      items: [{ description: 'Beratung', quantity: 2, unit: 'h', price: 95, taxRate: 19 }],
    },
  },
  {
    id: 'screenshot-offer',
    kind: 'offer',
    number: 'AN-2026-001',
    date: '2026-11-02',
    recipient: 'Beispielkunde GmbH',
    total: 119,
    issuedAt: '2026-11-02T10:00:00.000Z',
    doc: {
      number: 'AN-2026-001',
      date: '2026-11-02',
      recipient: { name: 'Beispielkunde GmbH', address: 'Beispielstraße 1', city: '10115 Berlin' },
      items: [{ description: 'Konzept', quantity: 1, unit: 'h', price: 100, taxRate: 19 }],
    },
  },
]

const pdf = (text = 'PDFCraft screenshot') => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const stream = `BT /F1 16 Tf 48 790 Td (${text}) Tj ET`
  objects.push(`<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`)
  let document = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(new TextEncoder().encode(document).length)
    document += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = new TextEncoder().encode(document).length
  document += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`
  document += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  document += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return document
}

const mockFetch = `
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.includes('/v1/')) return originalFetch(input, init);
    if (url.pathname.endsWith('/v1/checkout/offers')) return new Response(JSON.stringify({
      enabled: true, currency: 'EUR', offers: [{ plan: 'starter', days: 31, amount: '2.90', limitPerMinute: 30 }]
    }), { headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.endsWith('/v1/free-token')) return new Response(JSON.stringify({
      token: 'pf_screenshot_example', expiresAt: Math.floor(Date.now() / 1000) + 3600
    }), { headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.endsWith('/v1/token')) return new Response(JSON.stringify({
      kind: 'free', id: 'screenshot', plan: 'free', limitPerMinute: 5, bulkMax: 5, expiresAt: null, subscription: false
    }), { headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.endsWith('/v1/checkout')) return new Response(JSON.stringify({
      checkoutUrl: location.href, order: 'screenshot-order'
    }), { headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.endsWith('/v1/postage/products')) return new Response(JSON.stringify({
      products: [], sandbox: false, loginRequired: true
    }), { headers: { 'Content-Type': 'application/json' } });
    if (url.pathname.includes('/v1/invoices') || url.pathname.includes('/v1/documents')) {
      return new Response(${JSON.stringify(pdf())}, { headers: { 'Content-Type': 'application/pdf' } });
    }
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  };
`

await mkdir(output, { recursive: true })
const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false }, clearScreen: false })
let browser

try {
  await server.listen()
  const address = server.httpServer.address()
  if (!address || typeof address === 'string') throw new Error('Vite did not provide a local HTTP address')
  const baseUrl = `http://127.0.0.1:${address.port}`
  browser = await chromium.launch()

  for (const language of ['de', 'en']) {
    for (const theme of ['light', 'dark']) {
      for (const width of widths) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme })
        await context.addInitScript(
          ({ language, theme, archive, mockFetch }) => {
            localStorage.setItem('pdfcraft.lang', language)
            localStorage.setItem('pdfcraft.theme', theme)
            localStorage.setItem('pdfcraft.archive', JSON.stringify(archive))
            localStorage.setItem('pdfcraft.masterData', JSON.stringify({
              masterDataVersion: 1,
              contacts: [{ id: 'screenshot-contact', name: 'Beispielkunde GmbH', address: 'Beispielstraße 1', city: '10115 Berlin', vatId: '', email: '', buyerReference: '' }],
              articles: [{ id: 'screenshot-article', description: 'Beratung', unit: 'h', price: 95, taxRate: 19 }],
            }))
            ;(0, eval)(mockFetch)
          },
          { language, theme, archive, mockFetch },
        )
        const page = await context.newPage()
        for (const route of routes) {
          const routeName = route || 'start'
          await page.goto(`${baseUrl}/app/?capture=${language}-${theme}-${width}-${routeName}#/${route}`, { waitUntil: 'networkidle' })
          await page.locator('.app-header').waitFor()
          await page.waitForTimeout(100)
          const layout = await page.evaluate(() => {
            const header = document.querySelector('.app-header')
            const nav = document.querySelector('.header-nav')
            return {
              headerHeight: header?.getBoundingClientRect().height ?? 0,
              navOverflow: !!nav && nav.scrollWidth > nav.clientWidth + 1,
              headerOverflow: !!header && header.scrollWidth > header.clientWidth + 1,
            }
          })
          const maxHeaderHeight = width < 840 ? 64 : 72
          if (layout.navOverflow || layout.headerOverflow || layout.headerHeight > maxHeaderHeight) {
            throw new Error(`Shell overflow at ${language}/${theme}/${width}/${routeName}: ${JSON.stringify(layout)}`)
          }
          if (route === 'more') {
            await page.locator('.header-overflow > summary').click()
            const languageWidth = await page.locator('.header-overflow-menu .language-selector').evaluate((element) => element.getBoundingClientRect().width)
            if (languageWidth > 160) throw new Error(`Language selector is too wide at ${width}px: ${languageWidth}px`)
            await page.locator('.header-overflow > summary').click()
          }
          await page.screenshot({ path: resolve(output, `${language}-${theme}-${width}-${routeName}.png`), fullPage: true })
        }
        await context.close()
      }
    }
  }
  for (const theme of ['light', 'dark']) {
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme })
      const page = await context.newPage()
      await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' })
      const layout = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        background: getComputedStyle(document.body).backgroundColor,
      }))
      const expectedBackground = theme === 'dark' ? 'rgb(20, 18, 26)' : 'rgb(253, 248, 255)'
      if (layout.theme !== theme || layout.overflow || layout.background !== expectedBackground) {
        throw new Error(`Landing page layout/theme failed at ${theme}/${width}px: ${JSON.stringify(layout)}`)
      }
      await page.screenshot({ path: resolve(output, `landing-${theme}-${width}.png`), fullPage: true })
      await context.close()
    }
  }
  const overrideContext = await browser.newContext({ viewport: { width: 390, height: 900 }, colorScheme: 'light' })
  await overrideContext.addInitScript(() => localStorage.setItem('pdfcraft.theme', 'dark'))
  const overridePage = await overrideContext.newPage()
  await overridePage.goto(`${baseUrl}/`, { waitUntil: 'networkidle' })
  if (await overridePage.locator('html').getAttribute('data-theme') !== 'dark') {
    throw new Error('Landing page did not honor the saved dark theme override')
  }
  await overrideContext.close()
  console.log(`Saved ${2 * 2 * widths.length * routes.length + 2 * widths.length} screenshots to ${output}`)
} catch (error) {
  if (String(error).includes('Executable doesn’t exist') || String(error).includes('Executable doesn\'t exist')) {
    console.error('Chromium is not installed. Run `npx playwright install chromium` from frontend/.')
  }
  throw error
} finally {
  await browser?.close()
  await server.close()
}
