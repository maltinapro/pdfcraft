import { NOT_CHECKED, type CheckResult } from '../lib/einvoice/check'
import { StatusIcon, tr, useLang } from '@pdfcraft/editor'

export const KOSIT_VALIDATOR_URL = 'https://github.com/itplr-kosit/validator'
export const MUSTANG_URL = 'https://www.mustangproject.org/'

export const findingCount = (results: CheckResult[]): number => results.filter((r) => r.status === 'warning' || r.status === 'error').length

/** Result of the limited plausibility check: what was checked, what was found, what was NOT checked. Never says "valid". */
export function EInvoiceChecks({ results }: { results: CheckResult[] }) {
  useLang()
  const findings = findingCount(results)
  const skipped = results.filter((r) => r.status === 'skipped').length
  return (
    <div className="ev-checks">
      <p className={`ev-check-summary ${findings > 0 ? 'has-findings' : ''}`} role="status">
        {findings > 0
          ? tr(`${findings} von ${results.length} Prüfungen mit Auffälligkeiten.`, `${findings} of ${results.length} checks have findings.`)
          : tr(`Bei den ${results.length - skipped} durchgeführten Prüfungen gab es keine Auffälligkeiten.`, `The ${results.length - skipped} checks that ran found nothing unusual.`)}{' '}
        {tr('Das ist keine Gültigkeitsprüfung der Rechnung.', 'This is not a validation of the invoice.')}
      </p>

      <h3>{tr('Was geprüft wurde', 'What was checked')}</h3>
      <ul className="ev-check-list">
        {results.map((r) => (
          <li key={r.id} className={`ev-check ev-check-${r.status}`}>
            <span className="ev-check-icon" aria-hidden="true"><StatusIcon status={r.status} /></span>
            <div>
              <p>
                {r.title}
                <span className="ev-check-state">
                  {' — '}
                  {r.status === 'ok' && tr('keine Auffälligkeit', 'nothing unusual')}
                  {r.status === 'warning' && tr('Hinweis', 'notice')}
                  {r.status === 'error' && tr('Auffälligkeit', 'finding')}
                  {r.status === 'skipped' && tr('nicht geprüft', 'not checked')}
                </span>
              </p>
              {r.findings.length > 0 && (
                <ul>
                  {r.findings.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ul>

      <h3>{tr('Was nicht geprüft wurde', 'What was not checked')}</h3>
      <ul className="ev-not-checked">
        {NOT_CHECKED().map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p>
        {tr('Für eine vollständige Prüfung nutzen Sie einen offiziellen Validator, z. B. den ', 'For a full check use an official validator, e.g. the ')}
        <a href={KOSIT_VALIDATOR_URL} target="_blank" rel="noopener noreferrer">{tr('KoSIT-Prüftool', 'KoSIT validator')}</a>
        {tr(' (XRechnung) oder ', ' (XRechnung) or ')}
        <a href={MUSTANG_URL} target="_blank" rel="noopener noreferrer">Mustang</a>
        {tr(' (ZUGFeRD / Factur-X).', ' (ZUGFeRD / Factur-X).')}
      </p>
    </div>
  )
}
