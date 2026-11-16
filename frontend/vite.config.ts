import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Release version (build arg APP_VERSION in the Docker build), `dev` for local builds
const appVersion = process.env.APP_VERSION || 'dev'

// The OpenAPI spec lives in docs/ (source of truth) and is published as /api/openapi.yaml next to the reference page
// (api/index.html). The Docker build copies it to /docs/openapi.yaml, the same place relative to the build root.
const openapiFile = resolve(__dirname, '../docs/openapi.yaml')

// Header and footer shared by all static pages (placeholders `<!-- site-header -->` and `<!-- site-footer -->`).
// `<html lang="en">` pages get the `*.en.html` variants. The header marks the link to the current page with
// `aria-current="page"` at build time, so it needs no JavaScript.
const partial = (name: string, html: string) => {
  const lang = /<html[^>]*\slang="en"/.test(html) ? '.en' : ''
  return readFileSync(resolve(__dirname, `partials/${name}${lang}.html`), 'utf8')
}
const currentPage = (header: string, pagePath: string) => {
  const path = pagePath.split(/[?#]/)[0].replace(/index\.html$/, '')
  return path === '/' ? header : header.replaceAll(`<a href="${path}"`, `<a href="${path}" aria-current="page"`)
}
const themeBootstrap = `<script>
  (function () {
    var theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    try {
      var savedTheme = localStorage.getItem('pdfcraft.theme')
      if (savedTheme === 'light' || savedTheme === 'dark') theme = savedTheme
    } catch (e) {}
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#14121A' : '#241259'
  })()
</script>
`

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [
    react(),
    {
      name: 'openapi-spec',
      configureServer: (server) => {
        server.middlewares.use('/api/openapi.yaml', (_req, res) => {
          res.setHeader('Content-Type', 'application/yaml; charset=utf-8')
          res.end(readFileSync(openapiFile))
        })
      },
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'api/openapi.yaml', source: readFileSync(openapiFile) })
      },
    },
    {
      name: 'app-version-html',
      transformIndexHtml: {
        order: 'pre',
        handler: (html, ctx) => html
          .replace(/(<link rel="stylesheet" href="\/src\/(?:landing|site)\.css"\s*\/?>)/, `${themeBootstrap}$1`)
          .replace('<!-- site-header -->', () => currentPage(partial('site-header', html), ctx.path))
          .replace('<!-- site-footer -->', () => partial('site-footer', html))
          .replaceAll('__APP_VERSION__', appVersion),
      },
    },
    {
      // Static pages preload the Latin Inter subset so the web font swap does not shift the layout
      name: 'static-page-font-preload',
      transformIndexHtml: {
        order: 'post',
        handler: (html, ctx) => {
          if (!ctx.bundle || ctx.path.startsWith('/app/')) return html
          const font = Object.keys(ctx.bundle).find((name) => /inter-latin-wght-normal-.*\.woff2$/.test(name))
          if (!font) return html
          return html.replace('</head>', `  <link rel="preload" href="/${font}" as="font" type="font/woff2" crossorigin />\n  </head>`)
        },
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        landing: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app/index.html'),
        api: resolve(__dirname, 'api/index.html'),
        // SEO pages: one HTML file each (+ an entry in public/sitemap.xml and partials/site-footer.html)
        zugferd: resolve(__dirname, 'zugferd-rechnung-erstellen/index.html'),
        xrechnung: resolve(__dirname, 'xrechnung-generator/index.html'),
        stornorechnung: resolve(__dirname, 'stornorechnung-gutschrift-e-rechnung/index.html'),
        erechnungspflicht: resolve(__dirname, 'e-rechnungspflicht/index.html'),
        pruefen: resolve(__dirname, 'zugferd-xrechnung-pruefen/index.html'),
        impressum: resolve(__dirname, 'impressum.html'),
        datenschutz: resolve(__dirname, 'datenschutz.html'),
        agb: resolve(__dirname, 'agb.html'),
        widerruf: resolve(__dirname, 'widerruf.html'),
      },
      output: {
        // Emit assets with a .mjs extension (the pdf.js worker) as .js: some servers (nginx:alpine) send .mjs as
        // application/octet-stream, which browsers refuse for module workers
        assetFileNames: (asset) => {
          const name = asset.names?.[0] ?? ''
          return name.endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]'
        },
      },
    },
  },
  server: {
    port: 5173,
  },
})
