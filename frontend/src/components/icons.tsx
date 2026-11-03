import type { DocKind } from '../lib/documents'

const PATHS: Record<DocKind, string[]> = {
  invoice: ['M6 3h12v18l-3-2-3 2-3-2-3 2V3z', 'M9 8h6', 'M9 12h6', 'M9 16h3'],
  'credit-note': ['M6 3h12v18l-3-2-3 2-3-2-3 2V3z', 'M9 11h6', 'M10 7L8 9l2 2'],
  offer: ['M3 12V4h8l10 10-8 8L3 12z', 'M7.5 8.5h.01'],
  order: ['M9 4h6v3H9z', 'M7 5H5v16h14V5h-2', 'M9 14l2 2 4-4'],
  'delivery-note': ['M3 7l9-4 9 4-9 4-9-4z', 'M3 7v10l9 4 9-4V7', 'M12 11v10'],
  letter: ['M3 6h18v12H3z', 'M3 7l9 7 9-7'],
}

export function DocIcon({ kind, size = 24 }: { kind: DocKind; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[kind].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
