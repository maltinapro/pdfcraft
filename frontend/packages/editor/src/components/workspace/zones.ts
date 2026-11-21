import type { ZoneRect } from '../../lib/documents'
import type { Design } from '../../lib/types'

// Sender header area per design (mm, mirrors `header()` in `template/layout.typ`)
const senderHeader: Record<Design, ZoneRect> = {
  classic: { zone: 1, page: 1, x: 110, y: 5, w: 85, h: 38 },
  'modern-minimal': { zone: 1, page: 1, x: 25, y: 10, w: 165, h: 33 },
  contrast: { zone: 1, page: 1, x: 0, y: 0, w: 210, h: 27 },
}

export function fixedZonesFor(design: Design): ZoneRect[] {
  return [
    senderHeader[design] ?? senderHeader.classic,
    { zone: 1, page: 1, x: 25, y: 250, w: 160, h: 35 },
    { zone: 2, page: 1, x: 25, y: 45, w: 85, h: 47.4 },
  ]
}
