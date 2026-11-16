import SwaggerUI from 'swagger-ui-dist/swagger-ui-es-bundle.js'
import 'swagger-ui-dist/swagger-ui.css'
import './swaggerTheme.css'

// Same origin as the page (or VITE_API_BASE_URL) instead of the servers listed in the spec,
// so "Try it out" works on every deployment, including docker compose.
export function mountReference(apiBase: string) {
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
    onComplete: () => {
      document.querySelector('#swagger-ui select')?.setAttribute('aria-label', 'Server')
    },
  })
}
