import { AppHeader } from './AppHeader'
import { tr, useLang } from '@maltinapro/editor'
import { AppIcon, Card, Chip } from '@maltinapro/design'
import { LangToggle } from './LangToggle'
import { ThemeToggle } from './ThemeToggle'
import { useOffers } from '../lib/purchase'
import { routeHref } from '../lib/router'

interface Props {
  unsaved: number
}

export function MorePage({ unsaved }: Props) {
  useLang()
  const { enabled } = useOffers()
  const links = [
    { href: routeHref('viewer'), label: tr('E-Rechnung prüfen', 'Check e-invoice'), icon: 'viewer' as const, badge: undefined as string | undefined },
    {
      href: routeHref('data'),
      label: tr('Daten & Sicherung', 'Data & backup'),
      icon: 'cloud' as const,
      badge: unsaved > 0 ? tr(`${unsaved} offen`, `${unsaved} pending`) : undefined,
    },
    ...(enabled ? [{ href: routeHref('buy'), label: tr('Zugang kaufen', 'Buy access'), icon: 'store' as const }] : []),
  ]

  return (
    <div className="app app-scroll">
      <AppHeader title={tr('Mehr', 'More')} route="more" unsaved={unsaved} />
      <main className="page page-narrow">
        <h1>{tr('Mehr', 'More')}</h1>
        <Card heading={tr('Sprache und Darstellung', 'Language and appearance')}>
          <div className="card-stack">
            <div className="setting-row">
              <span>{tr('Sprache', 'Language')}</span>
              <LangToggle />
            </div>
            <div className="setting-row">
              <span>{tr('Farbschema', 'Color theme')}</span>
              <ThemeToggle />
            </div>
          </div>
        </Card>
        <nav aria-label={tr('Weitere Bereiche', 'More sections')}>
          <ul className="link-list">
            {links.map(({ href, label, icon, badge }) => (
              <li key={href}>
                <a className="link-row" href={href}>
                  <span className="link-row-icon"><AppIcon name={icon} /></span>
                  <span className="link-row-label">{label}</span>
                  {badge && <Chip kind="status" className="ui-chip-small">{badge}</Chip>}
                  <AppIcon name="forward" size={20} />
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <nav className="legal-links" aria-label={tr('Rechtliches', 'Legal')}>
          <a href="/impressum.html">{tr('Impressum', 'Legal notice')}</a>
          <a href="/datenschutz.html">{tr('Datenschutz', 'Privacy')}</a>
          <a href="/agb.html">{tr('Nutzungsbedingungen', 'Terms')}</a>
          <a href="/widerruf.html">{tr('Widerruf', 'Withdrawal')}</a>
        </nav>
      </main>
    </div>
  )
}
