import type { ReactNode } from 'react'
import { AppIcon, type AppIconName } from '../icons'

interface Props {
  /** `empty` (nothing here yet), `error` (something failed) or `loading` (work in progress). */
  tone?: 'empty' | 'error' | 'loading'
  icon?: AppIconName
  title: string
  text?: string
  /** The single primary action. */
  children?: ReactNode
}

/** One pattern for empty lists, errors and loading: icon, sentence, action. */
export function EmptyState({ tone = 'empty', icon, title, text, children }: Props) {
  return (
    <div className={`ui-empty ui-empty-${tone}`} role={tone === 'error' ? 'alert' : tone === 'loading' ? 'status' : undefined}>
      <span className="ui-empty-icon" aria-hidden="true">
        {tone === 'loading' ? <span className="ui-spinner" /> : <AppIcon name={icon ?? (tone === 'error' ? 'warning' : 'documents')} size={28} />}
      </span>
      <p className="ui-empty-title">{title}</p>
      {text && <p className="ui-empty-text">{text}</p>}
      {children && <div className="ui-empty-action">{children}</div>}
    </div>
  )
}
