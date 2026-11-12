/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_API_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}


declare module 'swagger-ui-dist/swagger-ui-es-bundle.js' {
  const SwaggerUI: (options: Record<string, unknown>) => unknown
  export default SwaggerUI
}
