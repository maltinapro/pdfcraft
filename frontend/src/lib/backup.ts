import { tr } from './i18n'
import { validEntries, type ArchiveEntry } from './archive'
import { parseDrafts, serializeDrafts, type DocDrafts } from './documents'
import { parseMasterData, serializeMasterData, type MasterData } from './masterData'
import { isObj, parseConfig, SCHEMA_VERSION, type AppConfig } from './storage'
import type { Invoice, Settings } from './types'

/**
 * Complete backup (`pdfcraft-backup.json`): sender/design, drafts, issued documents and master data in one file.
 * Version 2 added `masterData`; version 1 files still import.
 */
export const BACKUP_VERSION = 2
const LAST_BACKUP_KEY = 'pdfcraft.lastBackup'
const MAX_BACKUP_BYTES = 8 * 1024 * 1024

export interface BackupContent {
  /** Absent when an archive-only file was imported. */
  config?: AppConfig
  drafts?: DocDrafts
  archive: ArchiveEntry[]
  /** Absent in files without master data (backup version 1 and the older exports). */
  masterData?: MasterData
}

export function exportBackup(
  settings: Settings,
  invoice: Invoice,
  drafts: DocDrafts,
  archive: ArchiveEntry[],
  masterData: MasterData,
): Blob {
  const file = {
    backupVersion: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    config: { schemaVersion: SCHEMA_VERSION, settings, invoice },
    documents: serializeDrafts(drafts),
    archive: { archiveVersion: 1, entries: archive },
    masterData: serializeMasterData(masterData),
  }
  return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
}

/** Reads a backup file; the older config and archive exports are accepted as well. */
export async function readBackup(file: File): Promise<BackupContent> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error(tr('Datei ist zu groß.', 'File is too large.'))
  let json: unknown
  try {
    json = JSON.parse(await file.text())
  } catch {
    throw new Error(tr('Datei ist kein gültiges JSON.', 'File is not valid JSON.'))
  }
  if (!isObj(json)) throw new Error(tr('Das ist keine PDFCraft-Sicherung.', 'This is not a PDFCraft backup.'))
  if (json.backupVersion !== undefined) {
    if (typeof json.backupVersion !== 'number' || json.backupVersion > BACKUP_VERSION) {
      throw new Error(tr('Die Sicherung stammt aus einer neueren Version.', 'The backup comes from a newer version.'))
    }
    return {
      config: parseConfig(json.config),
      drafts: parseDrafts(json.documents),
      archive: isObj(json.archive) ? validEntries(json.archive.entries) : [],
      // Parsed strictly: an invalid section rejects the whole file before anything is applied
      ...(json.masterData !== undefined ? { masterData: parseMasterData(json.masterData) } : {}),
    }
  }
  if (json.archiveVersion === 1) return { archive: validEntries(json.entries) }
  if (typeof json.schemaVersion === 'number') return { config: parseConfig(json), archive: [] }
  throw new Error(tr('Das ist keine PDFCraft-Sicherung.', 'This is not a PDFCraft backup.'))
}

export function loadLastBackup(): string | null {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY)
  } catch {
    return null
  }
}

export function saveLastBackup(iso: string): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, iso)
  } catch {
    // ignore
  }
}

export function clearLastBackup(): void {
  try {
    localStorage.removeItem(LAST_BACKUP_KEY)
  } catch {
    // ignore
  }
}

/** Issued documents that are not part of the last backup (all of them if there was none). */
export function unsavedCount(archive: ArchiveEntry[], lastBackup: string | null): number {
  return lastBackup ? archive.filter((e) => e.issuedAt > lastBackup).length : archive.length
}
