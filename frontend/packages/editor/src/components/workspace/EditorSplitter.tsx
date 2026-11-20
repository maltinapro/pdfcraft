import { tr } from '../../lib/i18n'

export const SPLIT_MIN = 32
export const SPLIT_MAX = 58

interface Props {
  value: number
  onChange: (update: (value: number) => number) => void
  onDrag: (clientX: number) => void
}

export function EditorSplitter({ value, onChange, onDrag }: Props) {
  return (
    <div
      className="editor-splitter"
      role="separator"
      tabIndex={0}
      aria-label={tr('Breite des Formulars einstellen', 'Resize form width')}
      aria-orientation="vertical"
      aria-valuemin={SPLIT_MIN}
      aria-valuemax={SPLIT_MAX}
      aria-valuenow={value}
      aria-valuetext={`${value}%`}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        onDrag(event.clientX)
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) onDrag(event.clientX)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault()
          onChange((v) => Math.max(SPLIT_MIN, v - 1))
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault()
          onChange((v) => Math.min(SPLIT_MAX, v + 1))
        } else if (event.key === 'Home') {
          event.preventDefault()
          onChange(() => SPLIT_MIN)
        } else if (event.key === 'End') {
          event.preventDefault()
          onChange(() => SPLIT_MAX)
        }
      }}
    >
      <span className="editor-splitter-grip" aria-hidden="true" />
    </div>
  )
}
