import type { ReactNode } from 'react'
import { tr } from '../lib/i18n'
import { routeHref } from '../lib/router'
import { AppIcon } from './icons'
import { HeaderNav } from './HeaderNav'
import { LangToggle } from './LangToggle'
import { ThemeToggle } from './ThemeToggle'

interface Props {
  title?: string
  route?: string
  unsaved?: number
  children?: ReactNode
}

const EDITOR_ROUTES = ['invoice', 'credit-note', 'offer', 'order', 'delivery-note', 'letter', 'sender']

export function AppHeader({ title, route = '', unsaved = 0, children }: Props) {
  return (
    <header className="app-header">
      {EDITOR_ROUTES.includes(route) && (
        <a className="back-link" href={routeHref('')} aria-label={tr('Zurück zu Start', 'Back to Home')} title={tr('Zurück zu Start', 'Back to Home')}>
          <AppIcon name="back" />
        </a>
      )}
      <a className="app-title" href={routeHref('')} aria-label={tr('PDFCraft – Start', 'PDFCraft – Home')}>
        <img className="logo" src="/logo-mark.png" width="32" height="32" alt="" />
        <span className="app-brand-name">PDFCraft</span>
      </a>
      {title && <span className="app-page-title" title={title}>{title}</span>}
      <HeaderNav route={route} unsaved={unsaved} />
      <div className="header-actions">
        {children}
        <details className="header-overflow">
          <summary aria-label={tr('Mehr Optionen', 'More options')} title={tr('Mehr Optionen', 'More options')}>
            <AppIcon name="overflow" />
          </summary>
          <div className="header-overflow-menu">
            <div className="header-overflow-label">{tr('Sprache', 'Language')}</div>
            <LangToggle />
            <div className="header-overflow-label">{tr('Farbschema', 'Color theme')}</div>
            <ThemeToggle />
            <span className="app-version">{tr('Version', 'Version')} {__APP_VERSION__}</span>
            <a className="help-link" href="https://github.com/maltinapro/pdfcraft/tree/main/docs" target="_blank" rel="noopener noreferrer">
              <AppIcon name="help" size={18} /> {tr('Hilfe und Anleitungen', 'Help and guides')}
            </a>
          </div>
        </details>
      </div>
    </header>
  )
}
