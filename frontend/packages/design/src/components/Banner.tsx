import type { HTMLAttributes, ReactNode } from 'react'
import { AppIcon } from '../icons'

interface Props extends HTMLAttributes<HTMLDivElement> {
  tone?: 'info' | 'warning' | 'error' | 'success'
  /** Shows a close button that calls this handler. */
  onDismiss?: () => void
  /** Accessible name of the close button. */
  dismissLabel?: string
  children: ReactNode
}

export function Banner({ tone = 'info', className = '', onDismiss, dismissLabel = 'Close', children, ...props }: Props) {
  return (
    <div {...props} className={`ui-banner ui-banner-${tone}${className ? ` ${className}` : ''}`} role={props.role ?? (tone === 'error' ? 'alert' : 'status')}>
      <div className="ui-banner-text">{children}</div>
      {onDismiss && (
        <button type="button" className="ui-banner-close" onClick={onDismiss} aria-label={dismissLabel} title={dismissLabel}>
          <AppIcon name="close" size={20} />
        </button>
      )}
    </div>
  )
}
