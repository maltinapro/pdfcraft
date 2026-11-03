import type { ReactNode } from 'react'
import { routeHref } from '../lib/router'

interface Props {
  /** Shown next to the back link; the dashboard has no back link. */
  title?: string
  children?: ReactNode
}

export function AppHeader({ title, children }: Props) {
  return (
    <header className="app-header">
      <a className="app-title" href={routeHref('')} aria-label="Zur Übersicht">
        <img className="logo" src="/logo-mark.png" width="32" height="32" alt="" /> PDFCraft
        <span className="app-version" title="Version">{__APP_VERSION__}</span>
      </a>
      {title ? (
        <p className="app-subtitle">
          <a className="back-link" href={routeHref('')}>← Übersicht</a>
          <span className="crumb-sep">/</span>
          <strong>{title}</strong>
        </p>
      ) : (
        <p className="app-subtitle" />
      )}
      <div className="header-actions">{children}</div>
    </header>
  )
}
