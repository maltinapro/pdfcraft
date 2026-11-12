import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Release version (build arg APP_VERSION in the Docker build), `dev` for local builds
const appVersion = process.env.APP_VERSION || 'dev'

// The OpenAPI spec lives in docs/ (source of truth) and is published as /api/openapi.yaml next to the reference page
// (api/index.html). The Docker build copies it to /docs/openapi.yaml, the same place relative to the build root.
const openapiFile = resolve(__dirname, '../docs/openapi.yaml')

// Footer shared by the landing page and the SEO pages (placeholder `<!-- site-footer -->`)
const footerFile = resolve(__dirname, 'partials/site-footer.html')

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
      transformIndexHtml: (html) =>
        html.replace('<!-- site-footer -->', () => readFileSync(footerFile, 'utf8')).replaceAll('__APP_VERSION__', appVersion),
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
        impressum: resolve(__dirname, 'impressum.html'),
        datenschutz: resolve(__dirname, 'datenschutz.html'),
        agb: resolve(__dirname, 'agb.html'),
        widerruf: resolve(__dirname, 'widerruf.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
})
