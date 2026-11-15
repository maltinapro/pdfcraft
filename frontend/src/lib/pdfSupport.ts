// Browsers without a built-in PDF viewer (e.g. Chrome on Android) cannot show PDFs in an iframe
export const inlinePdfSupported = (): boolean => navigator.pdfViewerEnabled !== false

// Same cap as pdf.js uses for its own viewer on mobile: larger canvases may fail or stay blank on phones
export const MAX_CANVAS_PIXELS = 5_242_880

/** Render scale for a page drawn `cssWidth` CSS pixels wide, sharp on high-density screens but capped in size. */
export function canvasScale(cssWidth: number, pixelRatio: number, pageWidth: number, pageHeight: number): number {
  const wanted = (cssWidth / pageWidth) * Math.max(pixelRatio, 1)
  const limit = Math.sqrt(MAX_CANVAS_PIXELS / (pageWidth * pageHeight))
  return Math.min(wanted, limit)
}
