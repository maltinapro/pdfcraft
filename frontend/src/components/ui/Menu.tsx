import type { ReactNode } from 'react'
import { AppIcon } from '../icons'

interface Props {
  label: string
  children: ReactNode
}

export function Menu({ label, children }: Props) {
  return (
    <details className="ui-menu">
      <summary aria-label={label} title={label}><AppIcon name="more" /></summary>
      <div className="ui-menu-content">{children}</div>
    </details>
  )
}
