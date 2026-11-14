// Browsers without a built-in PDF viewer (e.g. Chrome on Android) cannot show PDFs in an iframe
export const inlinePdfSupported = (): boolean => navigator.pdfViewerEnabled !== false
