import { setLang, tr, useLang } from '@pdfcraft/editor'
import { SegmentedButton } from './ui'

export function LangToggle() {
  const lang = useLang()
  return (
    <div className="language-selector">
      <SegmentedButton label={tr('Sprache', 'Language')} value={lang} options={[
        { value: 'de', label: 'DE' },
        { value: 'en', label: 'EN' },
      ]} onChange={setLang} />
    </div>
  )
}
