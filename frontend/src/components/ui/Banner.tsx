import type { HTMLAttributes, ReactNode } from 'react'
import { AppIcon } from '../icons'
import { tr } from '../../lib/i18n'

interface Props extends HTMLAttributes<HTMLDivElement> {
  tone?: 'info' | 'warning' | 'error' | 'success'
  /** Shows a close button that calls this handler. */
  onDismiss?: () => void
  children: ReactNode
}

export function Banner({ tone = 'info', className = '', onDismiss, children, ...props }: Props) {
  return (
    <div {...props} className={`ui-banner ui-banner-${tone}${className ? ` ${className}` : ''}`} role={props.role ?? (tone === 'error' ? 'alert' : 'status')}>
      <div className="ui-banner-text">{children}</div>
      {onDismiss && (
        <button type="button" className="ui-banner-close" onClick={onDismiss} aria-label={tr('Schließen', 'Close')} title={tr('Schließen', 'Close')}>
          <AppIcon name="close" size={20} />
        </button>
      )}
    </div>
  )
}
