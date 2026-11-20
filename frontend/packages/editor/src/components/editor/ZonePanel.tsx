import type { ReactNode } from 'react'
import type { ZoneSpec } from '../../lib/documents'
import { tr } from '../../lib/i18n'

interface Props {
  zone: ZoneSpec
  total: number
  children: ReactNode
}

export function ZonePanel({ zone, total, children }: Props) {
  return (
    <section className={`zone-panel zone-${zone.id}`} aria-labelledby={`zone-title-${zone.id}`}>
      <header className="zone-panel-header">
        <p className="zone-kicker">{tr(`Schritt ${zone.number} von ${total}`, `Step ${zone.number} of ${total}`)}</p>
        <h2 id={`zone-title-${zone.id}`} tabIndex={-1}>{zone.label}</h2>
        {zone.id === 'sender' && <p className="zone-note">{tr('Gilt für alle Dokumente.', 'Applies to all documents.')}</p>}
      </header>
      {children}
    </section>
  )
}
