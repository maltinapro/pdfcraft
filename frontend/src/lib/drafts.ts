import { type DocDrafts, defaultDrafts, parseDrafts, serializeDrafts } from '@maltinapro/pdfcraft-editor'

// Drafts of the other document types live in this browser only (`localStorage`).
const STORAGE_KEY = 'pdfcraft.documents'

export function loadDrafts(): DocDrafts {
  try {
    return parseDrafts(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    return defaultDrafts()
  }
}

export function saveDrafts(drafts: DocDrafts): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeDrafts(drafts)))
    return true
  } catch {
    return false
  }
}

export function clearDrafts(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
