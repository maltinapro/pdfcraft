import './apiReference.css'

const apiBase = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || window.location.origin).replace(/\/$/, '')

const example = document.getElementById('curl-example')
if (example) {
  example.textContent = `curl -X POST ${apiBase}/v1/invoices \\
  -H 'Authorization: ******' -H 'content-type: application/json' \\
  -d '{"settings":{"sender":{"name":"Muster GmbH","address":"Musterstr. 1","city":"12345 Musterstadt"}},
       "invoice":{"number":"2026-001","date":"2026-01-31",
         "recipient":{"name":"Kunde AG","address":"Kundenweg 5","city":"54321 Kundenstadt"},
         "items":[{"description":"Beratung","quantity":8,"unit":"h","price":95,"taxRate":19}]}}' \\
  -o invoice.pdf`
}

// Swagger UI is about 1.5 MB: load it on request (or when the URL has a #anchor) to keep the page fast
const gate = document.getElementById('reference-gate')
const button = document.getElementById('load-reference') as HTMLButtonElement | null

async function loadReference() {
  if (!button) return
  button.disabled = true
  button.textContent = 'Loading…'
  try {
    const { mountReference } = await import('./swaggerReference')
    mountReference(apiBase)
    gate?.remove()
  } catch {
    button.disabled = false
    button.textContent = 'Loading failed, try again'
  }
}

button?.addEventListener('click', () => void loadReference())
if (window.location.hash.length > 1) void loadReference()
