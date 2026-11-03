import { setLang, tr, useLang } from '../lib/i18n'

export function LangToggle() {
  const lang = useLang()
  return (
    <div className="lang-toggle" role="group" aria-label={tr('Sprache', 'Language')}>
      {(['de', 'en'] as const).map((l) => (
        <button
          key={l}
          className={`btn${lang === l ? ' btn-primary' : ''}`}
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
