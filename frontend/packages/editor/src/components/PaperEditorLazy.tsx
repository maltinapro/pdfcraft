import { lazy, Suspense } from 'react'
import type { PaperEditorProps } from './PaperEditor'

// The editor (forms, zone panels, preview) is its own chunk, so a host's start page does not load it.
const Editor = lazy(() => import('./PaperEditor').then((m) => ({ default: m.PaperEditor })))

export function PaperEditor(props: PaperEditorProps) {
  return (
    <Suspense fallback={null}>
      <Editor {...props} />
    </Suspense>
  )
}
