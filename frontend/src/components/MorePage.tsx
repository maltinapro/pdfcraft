import { AppHeader } from './AppHeader'
import { AppIcon } from './icons'
import { LangToggle } from './LangToggle'
import { ThemeToggle } from './ThemeToggle'
import { tr, useLang } from '../lib/i18n'
import { useOffers } from '../lib/purchase'
import { routeHref } from '../lib/router'

interface Props {
  unsaved: number
}

export function MorePage({ unsaved }: Props) {
  useLang()
  const { enabled } = useOffers()
  const links = [
    { href: routeHref('viewer'), label: tr('E-Rechnung prüfen', 'Check e-invoice'), icon: 'viewer' as const },
    { href: routeHref('data'), label: tr('Daten & Sicherung', 'Data & backup'), icon: 'documents' as const },
    ...(enabled ? [{ href: routeHref('buy'), label: tr('Zugang kaufen', 'Buy access'), icon: 'home' as const }] : []),
  ]

  return (
    <div className="app app-scroll">
      <AppHeader title={tr('Mehr', 'More')} route="more" unsaved={unsaved} />
      <main className="dashboard more-page">
        <h1>{tr('Mehr', 'More')}</h1>
        <section className="more-settings" aria-label={tr('Sprache und Darstellung', 'Language and appearance')}>
          <div>
            <h2>{tr('Sprache', 'Language')}</h2>
            <LangToggle />
          </div>
          <div>
            <h2>{tr('Farbschema', 'Color theme')}</h2>
            <ThemeToggle />
          </div>
        </section>
        <nav className="more-links" aria-label={tr('Weitere Bereiche', 'More sections')}>
          {links.map(({ href, label, icon }) => (
            <a key={href} href={href}>
              <AppIcon name={icon} />
              <span>{label}</span>
              {label === tr('Daten & Sicherung', 'Data & backup') && unsaved > 0 && (
                <span className="more-badge">{tr(`${unsaved} offen`, `${unsaved} pending`)}</span>
              )}
            </a>
          ))}
          <div className="more-legal">
            <a href="/impressum.html">{tr('Impressum', 'Legal notice')}</a>
            <a href="/datenschutz.html">{tr('Datenschutz', 'Privacy')}</a>
            <a href="/agb.html">{tr('Nutzungsbedingungen', 'Terms')}</a>
            <a href="/widerruf.html">{tr('Widerruf', 'Withdrawal')}</a>
          </div>
        </nav>
      </main>
    </div>
  )
}
