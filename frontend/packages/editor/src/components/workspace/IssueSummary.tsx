import { fieldTitle } from '../../lib/apiErrors'
import { tr } from '../../lib/i18n'
import type { Issue } from '../../lib/validate'

export function PreviewError({ message }: { message: string }) {
  return (
    <div className="preview-error" role="alert">
      <strong>{`${tr('Vorschau fehlgeschlagen', 'Preview failed')}: ${message}`}</strong>
    </div>
  )
}

export function PreviewPaused({ count, onShow }: { count: number; onShow: () => void }) {
  return (
    <div className="preview-paused">
      <span>
        {count === 1
          ? tr('Vorschau pausiert: 1 Angabe fehlt oder ist ungültig.', 'Preview paused: 1 entry is missing or invalid.')
          : tr(`Vorschau pausiert: ${count} Angaben fehlen oder sind ungültig.`, `Preview paused: ${count} entries are missing or invalid.`)}
      </span>
      <button type="button" className="btn btn-small" onClick={onShow}>
        {tr('Anzeigen', 'Show')}
      </button>
    </div>
  )
}

interface SummaryProps {
  issues: Issue[]
  kind: string
  onJump: (field: string) => void
  open: boolean
}

export function IssueSummary({ issues, kind, onJump, open }: SummaryProps) {
  const errors = issues.filter((issue) => issue.level === 'error').length
  const title =
    errors === 0
      ? issues.length === 1
        ? tr('1 Hinweis', '1 note')
        : tr(`${issues.length} Hinweise`, `${issues.length} notes`)
      : errors === 1
        ? tr('1 Angabe prüfen', '1 entry needs attention')
        : tr(`${errors} Angaben prüfen`, `${errors} entries need attention`)
  return (
    <details className={errors === 0 ? 'issue-summary notes-only' : 'issue-summary'} open={open}>
      <summary className="issue-summary-title">{title}</summary>
      <ul>
        {issues.map((issue) => {
          const where = issue.field ? fieldTitle(issue.field, kind) : null
          const text = where ? `${where}: ${issue.message}` : issue.message
          return (
            <li key={`${issue.field ?? ''}|${issue.message}`} className={`issue issue-${issue.level}`}>
              {issue.field ? (
                <button type="button" className="issue-link" onClick={() => onJump(issue.field as string)}>
                  {text}
                </button>
              ) : (
                text
              )}
            </li>
          )
        })}
      </ul>
    </details>
  )
}
