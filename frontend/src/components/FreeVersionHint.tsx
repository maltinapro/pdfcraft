import { useState } from 'react'
import { hasActivePaidToken } from '../lib/api'
import { tr, useLang } from '../lib/i18n'
import { useOffers } from '../lib/purchase'
import { routeHref } from '../lib/router'

const DISMISSED_KEY = 'pdfcraft.freeHintDismissed'

function dismissedBefore(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

/** Points free users to the shop; only shown when purchases are enabled and no valid paid token is stored. */
export function FreeVersionHint() {
  useLang()
  const { enabled } = useOffers()
  const [dismissed, setDismissed] = useState(dismissedBefore)
  if (!enabled || dismissed || hasActivePaidToken()) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      sessionStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // storage unavailable: the hint only stays hidden until the next reload
    }
  }

  return (
    <div className="notice notice-info" role="note">
      <span>
        {tr(
          'Kostenlose Version: Die PDFs tragen das Wasserzeichen „Entwurf“. ',
          'Free version: PDFs carry the “Draft” watermark. ',
        )}
        <a href={routeHref('buy')}>{tr('Token kaufen und PDFs ohne Wasserzeichen erstellen', 'Buy a token for PDFs without a watermark')}</a>
      </span>
      <button type="button" className="notice-close" onClick={dismiss} aria-label={tr('Schließen', 'Close')}>×</button>
    </div>
  )
}
