import type { ZoneId, ZoneRect } from '../../lib/documents'
import { tr } from '../../lib/i18n'

interface Props {
  page: number
  widthMm: number
  heightMm: number
  zones: readonly ZoneRect[]
  active: ZoneId
  /** Name of zone 4 when it is not "Items" (letters have a text). */
  itemsLabel?: string
  onSelect: (zone: ZoneId) => void
}

const zoneByNumber: Record<number, ZoneId> = {
  1: 'sender',
  2: 'recipient',
  3: 'details',
  4: 'items',
}

const zoneLabels: Record<number, [string, string]> = {
  1: ['1 · Absender', '1 · Sender'],
  2: ['2 · Empfänger', '2 · Recipient'],
  3: ['3 · Details', '3 · Details'],
  4: ['4 · Positionen', '4 · Items'],
}

export function ZoneOverlay({ page, widthMm, heightMm, zones, active, itemsLabel, onSelect }: Props) {
  const areas = zones.filter((area) => area.page === page && zoneByNumber[area.zone])
  return (
    <div className="zone-overlay" aria-label={tr('Dokumentbereiche', 'Document zones')}>
      {areas.map((area, index) => {
        const zone = zoneByNumber[area.zone]
        const [de, en] = zoneLabels[area.zone]
        const label = area.zone === 4 && itemsLabel ? [`4 · ${itemsLabel}`, `4 · ${itemsLabel}`] : [de, en]
        return (
          <button
            type="button"
            className={`zone-overlay-area zone-${zone}${active === zone ? ' active' : ''}`}
            key={`${area.zone}-${index}`}
            style={{
              left: `${(area.x / widthMm) * 100}%`,
              top: `${(area.y / heightMm) * 100}%`,
              width: `${(area.w / widthMm) * 100}%`,
              height: `${(area.h / heightMm) * 100}%`,
            }}
            aria-label={tr(`${label[0]} öffnen`, `Open ${label[1]}`)}
            onClick={() => onSelect(zone)}
          >
            <span className="zone-overlay-label">{tr(label[0], label[1])}</span>
          </button>
        )
      })}
    </div>
  )
}
