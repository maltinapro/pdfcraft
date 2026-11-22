import './base.css'
// Public API of @maltinapro/editor. Everything else is internal.

// Editor and its adapter
export { PaperEditor } from './components/PaperEditorLazy'
export type { PaperEditorProps } from './components/PaperEditor'
export * from './adapter'
export { useAutosave, type SaveState } from './lib/saveState'

// Document model
export * from './lib/types'
export * from './lib/documents'
export * from './lib/catalog'
export * from './lib/parse'
export * from './lib/validate'
export * from './lib/errors'
export * from './lib/apiErrors'
export * from './lib/format'
export * from './lib/i18n'
export { downloadBlob } from './lib/download'

// Building blocks the host app can reuse
export { Field, SelectField, TextAreaField, TextField } from './components/ui/Field'
