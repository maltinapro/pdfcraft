import { useRef } from 'react'
import { AppHeader } from './AppHeader'
import { tr, uiLocale, useLang } from '@maltinapro/editor'
import { AppIcon, Banner, Button, Card } from '@maltinapro/design'

interface Props {
  notice: string | null
  onDismissNotice: () => void
  lastBackup: string | null
  unsaved: number
  onBackup: () => void
  onRestore: (file: File | undefined) => void
  onExportConfig: () => void
  onImportConfig: (file: File | undefined) => void
  onReset: () => void
}

/** Where the data lives, one-click backup and restore, and the destructive reset. */
export function DataPage({ notice, onDismissNotice, lastBackup, unsaved, onBackup, onRestore, onExportConfig, onImportConfig, onReset }: Props) {
  useLang()
  const restoreRef = useRef<HTMLInputElement>(null)
  const configRef = useRef<HTMLInputElement>(null)
  const when = lastBackup ? new Date(lastBackup).toLocaleString(uiLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : null

  return (
    <div className="app app-scroll">
      <AppHeader title={tr('Daten & Sicherung', 'Data & backup')} route="data" unsaved={unsaved} />

      <main className="page page-narrow">
        {notice && <Banner dismissLabel={tr('Schließen', 'Close')} onDismiss={onDismissNotice}>{notice}</Banner>}

        <h1>{tr('Daten & Sicherung', 'Data & backup')}</h1>
        <p className="page-lead">
          {tr(
            'PDFCraft hat kein Benutzerkonto und speichert nichts auf unseren Servern. Ihre Angaben und Belege liegen ausschließlich in diesem Browser auf diesem Gerät.',
            'PDFCraft has no user account and stores nothing on our servers. Your details and documents are kept only in this browser on this device.',
          )}
        </p>

        <Card tone="primary" heading={tr('Sicherung', 'Backup')}>
          <p>
            {tr(
              'Laden Sie Ihre Daten regelmäßig als Datei herunter und bewahren Sie diese an einem sicheren Ort auf (z. B. Cloud-Speicher oder USB-Stick). Die Datei enthält Absender, Logo, Unterschrift, Entwürfe, gespeicherte Kunden und Artikel sowie alle Belege.',
              'Download your data as a file regularly and keep it in a safe place (e.g. cloud storage or a USB stick). The file contains sender, logo, signature, drafts, saved customers and articles, and all documents.',
            )}
          </p>
          <p className="data-status" data-state={unsaved > 0 || !when ? 'warn' : 'ok'}>
            {when
              ? tr(`Zuletzt gesichert: ${when}`, `Last backup: ${when}`)
              : tr('Noch nicht gesichert.', 'Not backed up yet.')}
            {unsaved > 0 && ' · ' + (unsaved === 1 ? tr('1 neuer Beleg seitdem', '1 new document since') : tr(`${unsaved} neue Belege seitdem`, `${unsaved} new documents since`))}
          </p>
          <div className="card-actions">
            <Button icon={<AppIcon name="download" />} onClick={onBackup}>{tr('Sicherung herunterladen', 'Download backup')}</Button>
          </div>
        </Card>

        <Card heading={tr('Wiederherstellen', 'Restore')}>
          <p>
            {tr(
              'Neuer Computer oder Browser-Daten gelöscht? Laden Sie hier Ihre Sicherung hoch. Aktuelle Absenderdaten und Entwürfe werden ersetzt, Belege sowie Kunden und Artikel aus der Datei werden ergänzt.',
              'New computer or browser data cleared? Upload your backup here. Current sender details and drafts are replaced, documents, customers and articles from the file are added.',
            )}
          </p>
          <div className="card-actions">
            <Button variant="tonal" onClick={() => restoreRef.current?.click()}>{tr('Sicherung hochladen …', 'Upload backup …')}</Button>
            <input
              ref={restoreRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                onRestore(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
        </Card>

        <Card tone="danger" heading={tr('Alles löschen', 'Delete everything')}>
          <p>
            {tr(
              'Entfernt Absenderdaten, Logo, Unterschrift, Entwürfe, Kunden, Artikel und alle Belege aus diesem Browser. Das lässt sich nicht rückgängig machen – sichern Sie vorher.',
              'Removes sender details, logo, signature, drafts, customers, articles and all documents from this browser. This cannot be undone – back up first.',
            )}
          </p>
          <div className="card-actions">
            <Button variant="danger" onClick={onReset}>{tr('Alle Daten löschen …', 'Delete all data …')}</Button>
          </div>
        </Card>

        <details className="ui-card ui-card-default">
          <summary>{tr('Für Entwickler: Konfiguration für die API', 'For developers: configuration for the API')}</summary>
          <p>
            {tr(
              'Nur Absender, Design und die Rechnung als pdfcraft-config.json – direkt verwendbar für POST /v1/invoices. Enthält keine Belege.',
              'Only sender, design and the invoice as pdfcraft-config.json – directly usable for POST /v1/invoices. Contains no documents.',
            )}
          </p>
          <div className="card-actions">
            <Button variant="tonal" onClick={onExportConfig}>{tr('Konfiguration exportieren', 'Export configuration')}</Button>
            <Button variant="tonal" onClick={() => configRef.current?.click()}>{tr('Konfiguration importieren', 'Import configuration')}</Button>
            <input
              ref={configRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                onImportConfig(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
        </details>
      </main>
    </div>
  )
}
