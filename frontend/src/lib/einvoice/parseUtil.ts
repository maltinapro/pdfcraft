export const num = (value: string | undefined): number | null => {
  if (value === undefined) return null
  const n = Number(value.trim())
  return value.trim() !== '' && Number.isFinite(n) ? n : null
}

/** CII dates use UN/EDIFACT formats (102 = `YYYYMMDD`); UBL uses ISO dates. Returns an ISO date. */
export function isoDate(value: string | undefined, format?: string): string | undefined {
  if (!value) return undefined
  const v = value.trim()
  if (/^\d{8}$/.test(v) && (!format || format === '102')) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(v)
  return iso ? iso[1] : v
}

export const definedList = <T>(list: (T | undefined)[]): T[] => list.filter((x): x is T => x !== undefined)
