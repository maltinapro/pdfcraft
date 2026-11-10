import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Release version (build arg APP_VERSION in the Docker build), `dev` for local builds
const appVersion = process.env.APP_VERSION || 'dev'

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [
    react(),
    {
      name: 'app-version-html',
      transformIndexHtml: (html) => html.replaceAll('__APP_VERSION__', appVersion),
    },
  ],
  build: {
    rollupOptions: {
      input: {
        landing: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app/index.html'),
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
