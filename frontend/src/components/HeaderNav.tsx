import { tr, useLang } from '@maltinapro/editor'
import { AppIcon } from '@maltinapro/design'
import { routeHref } from '../lib/router'
import { useHideNavOnScroll } from '../lib/useHideNavOnScroll'

interface Props {
  route: string
  unsaved: number
}

const destinations = [
  { route: '', label: ['Start', 'Home'] as const, icon: 'home' as const },
  { route: 'documents', label: ['Belege', 'Documents'] as const, icon: 'documents' as const },
  { route: 'contacts', label: ['Kunden', 'Customers'] as const, icon: 'customers' as const },
  { route: 'more', label: ['Mehr', 'More'] as const, icon: 'more' as const },
]

export function HeaderNav({ route, unsaved }: Props) {
  useLang()
  useHideNavOnScroll()
  const active = route === '' || ['invoice', 'credit-note', 'offer', 'order', 'delivery-note', 'letter', 'sender'].includes(route)
    ? ''
    : route === 'contacts' || route === 'articles'
      ? 'contacts'
      : route === 'documents'
        ? 'documents'
        : 'more'
  return (
    <nav className="header-nav" aria-label={tr('Hauptnavigation', 'Main navigation')}>
      {destinations.map((destination) => (
        <a
          key={destination.route}
          href={routeHref(destination.route)}
          aria-current={active === destination.route ? 'page' : undefined}
          aria-label={destination.label[0] === 'Mehr' && unsaved > 0
            ? tr('Mehr, nicht gesicherte Belege', 'More, documents not backed up')
            : tr(destination.label[0], destination.label[1])}
        >
          <AppIcon name={destination.icon} />
          <span>{tr(destination.label[0], destination.label[1])}</span>
          {destination.route === 'more' && unsaved > 0 && <span className="nav-dot" aria-hidden="true" />}
        </a>
      ))}
    </nav>
  )
}
