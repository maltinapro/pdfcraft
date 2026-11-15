import { setLang, tr, useLang } from '../lib/i18n'
import { SegmentedButton } from './ui'

export function LangToggle() {
  const lang = useLang()
  return (
    <SegmentedButton label={tr('Sprache', 'Language')} value={lang} options={[
      { value: 'de', label: 'DE' },
      { value: 'en', label: 'EN' },
    ]} onChange={setLang} />
  )
}
