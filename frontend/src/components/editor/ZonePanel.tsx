import type { ReactNode } from 'react'
import type { ZoneSpec } from '../../lib/documents'
import { tr } from '../../lib/i18n'

interface Props {
  zone: ZoneSpec
  children: ReactNode
}

export function ZonePanel({ zone, children }: Props) {
  return (
    <section className={`zone-panel zone-${zone.id}`} aria-labelledby={`zone-title-${zone.id}`}>
      <header className="zone-panel-header">
        <span className="zone-panel-number">{zone.number}</span>
        <div>
          <h2 id={`zone-title-${zone.id}`} tabIndex={-1}>{zone.label}</h2>
          {zone.id === 'sender' && (
            <p>{tr('Gilt für alle Dokumente.', 'Applies to all documents.')}</p>
          )}
        </div>
      </header>
      {children}
    </section>
  )
}
