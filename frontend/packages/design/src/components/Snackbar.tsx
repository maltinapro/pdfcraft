import type { ReactNode } from 'react'
import { useEffect } from 'react'

interface Props {
  open: boolean
  children: ReactNode
  onClose: () => void
  duration?: number
}

export function Snackbar({ open, children, onClose, duration = 4000 }: Props) {
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(onClose, duration)
    return () => window.clearTimeout(timer)
  }, [open, duration, onClose])
  if (!open) return null
  return <div className="ui-snackbar" role="status">{children}</div>
}
