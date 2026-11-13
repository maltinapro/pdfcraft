import { tr, useLang } from '../lib/i18n'
import { useOffers } from '../lib/purchase'
import { routeHref } from '../lib/router'

interface Props {
  route: 'documents' | 'contacts' | 'data' | 'buy' | ''
  /** Documents that are not in the last backup: shown as a dot on "Backup". */
  unsaved: number
}

/** Links to the pages besides the document types. */
export function HeaderNav({ route, unsaved }: Props) {
  useLang()
  const { enabled } = useOffers()
  return (
    <nav className="header-nav" aria-label={tr('Bereiche', 'Sections')}>
      <a href={routeHref('documents')} aria-current={route === 'documents' ? 'page' : undefined}>
        {tr('Meine Belege', 'My documents')}
      </a>
      <a href={routeHref('contacts')} aria-current={route === 'contacts' ? 'page' : undefined}>
        {tr('Kunden & Artikel', 'Customers & articles')}
      </a>
      {enabled && (
        <a href={routeHref('buy')} aria-current={route === 'buy' ? 'page' : undefined}>
          {tr('Token kaufen', 'Buy a token')}
        </a>
      )}
      <a href={routeHref('data')} aria-current={route === 'data' ? 'page' : undefined}>
        {tr('Daten & Sicherung', 'Data & backup')}
        {unsaved > 0 && <span className="nav-dot" title={tr('Noch nicht gesichert', 'Not backed up yet')} />}
      </a>
    </nav>
  )
}
