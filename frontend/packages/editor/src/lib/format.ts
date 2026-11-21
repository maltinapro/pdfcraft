import { uiLocale } from './i18n'
import { UNITS } from './types'

export const unitLabel = (unit: string): string => UNITS.find((u) => u.value === unit)?.label ?? unit
export const money = (n: number): string => n.toLocaleString(uiLocale(), { style: 'currency', currency: 'EUR' })
