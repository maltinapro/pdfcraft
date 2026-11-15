import type { DocKind } from '../lib/documents'

const PATHS: Record<DocKind, string[]> = {
  invoice: ['M6 3h12v18l-3-2-3 2-3-2-3 2V3z', 'M9 8h6', 'M9 12h6', 'M9 16h3'],
  'credit-note': ['M6 3h12v18l-3-2-3 2-3-2-3 2V3z', 'M9 11h6', 'M10 7L8 9l2 2'],
  offer: ['M3 12V4h8l10 10-8 8L3 12z', 'M7.5 8.5h.01'],
  order: ['M9 4h6v3H9z', 'M7 5H5v16h14V5h-2', 'M9 14l2 2 4-4'],
  'delivery-note': ['M3 7l9-4 9 4-9 4-9-4z', 'M3 7v10l9 4 9-4V7', 'M12 11v10'],
  letter: ['M3 6h18v12H3z', 'M3 7l9 7 9-7'],
}

const APP_PATHS = {
  home: ['M3 10.5 12 3l9 7.5', 'M5.5 9v11h13V9', 'M9 20v-6h6v6'],
  documents: ['M6 3h12v18H6z', 'M9 8h6', 'M9 12h6', 'M9 16h4'],
  customers: ['M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 4 18.5V20', 'M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M17 11a3 3 0 0 0 0-6', 'M20 20v-1.5a4.5 4.5 0 0 0-3-4.25'],
  more: ['M5 7h14', 'M5 12h14', 'M5 17h14'],
  overflow: ['M12 5h.01', 'M12 12h.01', 'M12 19h.01'],
  viewer: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z', 'm16 16 5 5'],
  download: ['M12 3v12', 'm7 10 5 5 5-5', 'M4 20h16'],
  check: ['m5 12 4 4L19 6'],
  warning: ['M12 3 2.8 20h18.4L12 3z', 'M12 9v4', 'M12 16h.01'],
  back: ['m15 18-6-6 6-6', 'M9 12h11'],
  close: ['m6 6 12 12', 'M18 6 6 18'],
  help: ['M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3', 'M12 17h.01', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'],
  sun: ['M12 3v2', 'M12 19v2', 'm5.64 5.64 1.42 1.42', 'm16.94 16.94 1.42 1.42', 'M3 12h2', 'M19 12h2', 'm5.64 18.36 1.42-1.42', 'm16.94 7.06 1.42-1.42', 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z'],
  moon: ['M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5z'],
  system: ['M3 4h18v13H3z', 'M8 21h8', 'M12 17v4'],
} as const

type AppIconName = keyof typeof APP_PATHS

function Svg({ paths, size = 24 }: { paths: readonly string[]; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  )
}

export function AppIcon({ name, size = 24 }: { name: AppIconName; size?: number }) {
  return <Svg paths={APP_PATHS[name]} size={size} />
}

export function StatusIcon({ status }: { status: 'ok' | 'warning' | 'error' | 'skipped' }) {
  const paths = status === 'ok' ? APP_PATHS.check : status === 'warning' || status === 'error' ? APP_PATHS.warning : ['M5 12h14']
  return <Svg paths={paths} size={16} />
}

export function DocIcon({ kind, size = 24 }: { kind: DocKind; size?: number }) {
  return <Svg paths={PATHS[kind]} size={size} />
}
