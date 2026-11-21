import { AppIcon, StatusIcon } from '../icons'
import type { ZoneId, ZoneSpec } from '../../lib/documents'
import type { SaveState } from '../../lib/saveState'
import { tr } from '../../lib/i18n'

interface Props {
  active: ZoneId
  zones: readonly ZoneSpec[]
  saveState: SaveState
  /** Where the user can back up the data; the "Back up" links are hidden without it. */
  backupHref?: string
  onBack: () => void
  onNext: () => void
  onCreate: () => void
}

export function EditorFooter({ active, zones, saveState, backupHref, onBack, onNext, onCreate }: Props) {
  const index = zones.findIndex((zone) => zone.id === active)
  const last = index === zones.length - 1

  return (
    <footer className="editor-footer">
      <div className="editor-save-status" data-state={saveState} role="status">
        {saveState === 'saving' ? (
          tr('Speichere …', 'Saving …')
        ) : saveState === 'saved' ? (
          <>
            <StatusIcon status="ok" /> {tr('Lokal gespeichert · ', 'Saved locally · ')}
            {backupHref && <a href={backupHref}>{tr('Sichern', 'Back up')}</a>}
          </>
        ) : (
          <>
            <StatusIcon status="warning" /> {tr('Speichern fehlgeschlagen · ', 'Saving failed · ')}
            {backupHref && <a href={backupHref}>{tr('Daten sichern', 'Back up data')}</a>}
          </>
        )}
      </div>
      <div className="editor-footer-actions">
        <button type="button" className="btn btn-tonal" onClick={onBack} disabled={index === 0}>
          {tr('Zurück', 'Back')}
        </button>
        {last ? (
          <button type="button" className="btn btn-primary" onClick={onCreate}>
            <AppIcon name="download" size={20} />
            {tr('PDF erstellen', 'Create PDF')}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onNext}>
            {tr('Weiter', 'Next')}
          </button>
        )}
      </div>
    </footer>
  )
}
