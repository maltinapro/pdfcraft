import type { ReactNode } from 'react'
import { tr } from '../lib/i18n'
import { routeHref } from '../lib/router'
import { LangToggle } from './LangToggle'

interface Props {
  /** Shown next to the back link; the dashboard has no back link. */
  title?: string
  children?: ReactNode
}

export function AppHeader({ title, children }: Props) {
  return (
    <header className="app-header">
      <a className="app-title" href={routeHref('')} aria-label={tr('Zur Übersicht', 'Back to overview')}>
        <img className="logo" src="/logo-mark.png" width="32" height="32" alt="" /> PDFCraft
        <span className="app-version" title={tr('Version', 'Version')}>{__APP_VERSION__}</span>
      </a>
      {title ? (
        <p className="app-subtitle">
          <a className="back-link" href={routeHref('')}>{tr('← Übersicht', '← Overview')}</a>
          <span className="crumb-sep">/</span>
          <strong>{title}</strong>
        </p>
      ) : (
        <p className="app-subtitle" />
      )}
      <div className="header-actions">
        <LangToggle />
        {children}
      </div>
    </header>
  )
}
