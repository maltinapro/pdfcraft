import { StatusIcon } from '../icons'
import type { ZoneId, ZoneSpec } from '../../lib/documents'
import type { SaveState } from '../Workspace'
import { routeHref } from '../../lib/router'
import { tr } from '../../lib/i18n'

interface Props {
  active: ZoneId
  zones: readonly ZoneSpec[]
  saveState: SaveState
  onBack: () => void
  onNext: () => void
  onCreate: () => void
}

export function EditorFooter({ active, zones, saveState, onBack, onNext, onCreate }: Props) {
  const index = zones.findIndex((zone) => zone.id === active)
  const last = index === zones.length - 1
  const next = zones[index + 1]

  return (
    <footer className="editor-footer">
      <div className="editor-save-status" data-state={saveState} role="status">
        {saveState === 'saving' ? (
          tr('Speichere …', 'Saving …')
        ) : saveState === 'saved' ? (
          <>
            <StatusIcon status="ok" /> {tr('In diesem Browser gespeichert · ', 'Saved in this browser · ')}
            <a href={routeHref('data')}>{tr('Sichern', 'Back up')}</a>
          </>
        ) : (
          <>
            <StatusIcon status="warning" /> {tr('Speichern fehlgeschlagen · ', 'Saving failed · ')}
            <a href={routeHref('data')}>{tr('Daten sichern', 'Back up data')}</a>
          </>
        )}
      </div>
      <div className="editor-footer-actions">
        <button type="button" className="btn btn-tonal" onClick={onBack} disabled={index === 0}>
          {tr('Zurück', 'Back')}
        </button>
        {last ? (
          <button type="button" className="btn btn-primary" onClick={onCreate}>
            {tr('PDF erstellen', 'Create PDF')}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onNext}>
            {tr(`Weiter: ${next.label}`, `Next: ${next.label}`)}
          </button>
        )}
      </div>
    </footer>
  )
}
