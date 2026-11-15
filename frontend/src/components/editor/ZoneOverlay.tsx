import type { ZoneId, ZoneRect } from '../../lib/documents'
import { tr } from '../../lib/i18n'

interface Props {
  page: number
  widthMm: number
  heightMm: number
  zones: readonly ZoneRect[]
  active: ZoneId
  onSelect: (zone: ZoneId) => void
}

const zoneByNumber: Record<number, ZoneId> = {
  1: 'sender',
  2: 'recipient',
  3: 'details',
  4: 'items',
}

export function ZoneOverlay({ page, widthMm, heightMm, zones, active, onSelect }: Props) {
  const areas = zones.filter((area) => area.page === page && zoneByNumber[area.zone])
  return (
    <div className="zone-overlay" aria-label={tr('Dokumentbereiche', 'Document zones')}>
      {areas.map((area, index) => {
        const zone = zoneByNumber[area.zone]
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
            aria-label={tr(`Bereich ${area.zone} öffnen`, `Open zone ${area.zone}`)}
            onClick={() => onSelect(zone)}
          />
        )
      })}
    </div>
  )
}
