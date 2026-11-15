import { describe, expect, it } from 'vitest'
import { canvasScale, MAX_CANVAS_PIXELS } from './pdfSupport'

const A4 = [595.28, 841.89] as const

describe('canvasScale', () => {
  it('renders at the device pixel ratio when the canvas stays small', () => {
    expect(canvasScale(390, 2, ...A4)).toBeCloseTo((390 / A4[0]) * 2)
  })

  it('caps the canvas size on dense phone screens', () => {
    // Pixel 9: 412 CSS px at ratio 2.625 would still fit; a wide pane at ratio 3 would not
    const scale = canvasScale(900, 3, ...A4)
    expect(A4[0] * scale * A4[1] * scale).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 1)
    expect(scale).toBeLessThan((900 / A4[0]) * 3)
  })
})
