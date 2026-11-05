import { tr, useLang } from '../lib/i18n'

interface Props {
  unsaved: number
  onBackup: () => void
}

/** Reminder: the data only lives in this browser until it is saved as a file. */
export function BackupBanner({ unsaved, onBackup }: Props) {
  useLang()
  if (unsaved === 0) return null
  return (
    <div className="backup-banner" role="status">
      <p>
        <strong>{tr('Bitte sichern Sie Ihre Belege.', 'Please back up your documents.')}</strong>{' '}
        {tr(
          'Sie liegen nur in diesem Browser und gehen verloren, wenn Sie dessen Daten löschen oder den Computer wechseln.',
          'They are only stored in this browser and are lost if you clear its data or switch computers.',
        )}{' '}
        {unsaved === 1
          ? tr('1 Beleg ist noch nicht gesichert.', '1 document is not backed up yet.')
          : tr(`${unsaved} Belege sind noch nicht gesichert.`, `${unsaved} documents are not backed up yet.`)}
      </p>
      <button className="btn btn-primary" onClick={onBackup}>{tr('Jetzt sichern', 'Back up now')}</button>
    </div>
  )
}
