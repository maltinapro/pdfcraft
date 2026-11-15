import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
  className?: string
}

export function Dialog({ open, title, children, onClose, className = '' }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog ref={ref} className={`ui-dialog${className ? ` ${className}` : ''}`} aria-label={title} onClose={onClose}>
      <h2>{title}</h2>
      {children}
    </dialog>
  )
}
