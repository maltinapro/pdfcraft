import SwaggerUI from 'swagger-ui-dist/swagger-ui-es-bundle.js'
import 'swagger-ui-dist/swagger-ui.css'
import './apiReference.css'

// Same origin as the page (or VITE_API_BASE_URL) instead of the servers listed in the spec,
// so "Try it out" works on every deployment, including docker compose.
const apiBase = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || window.location.origin).replace(/\/$/, '')

const example = document.getElementById('curl-example')
if (example) {
  example.textContent = `curl -X POST ${apiBase}/v1/invoices \\
  -H 'Authorization: Bearer YOUR_TOKEN' -H 'content-type: application/json' \\
  -d '{"settings":{"sender":{"name":"Muster GmbH","address":"Musterstr. 1","city":"12345 Musterstadt"}},
       "invoice":{"number":"2026-001","date":"2026-01-31",
         "recipient":{"name":"Kunde AG","address":"Kundenweg 5","city":"54321 Kundenstadt"},
         "items":[{"description":"Beratung","quantity":8,"unit":"h","price":95,"taxRate":19}]}}' \\
  -o invoice.pdf`
}

SwaggerUI({
  dom_id: '#swagger-ui',
  url: './openapi.yaml',
  docExpansion: 'list',
  defaultModelsExpandDepth: 0,
  requestInterceptor: (request: { url: string }) => {
    const url = new URL(request.url, window.location.href)
    if (url.pathname.startsWith('/v1/')) request.url = `${apiBase}${url.pathname}${url.search}`
    return request
  },
})
