import { tr } from '@maltinapro/pdfcraft-editor'

export type OnboardingId = 'company' | 'document' | 'backup'

export interface OnboardingStep {
  id: OnboardingId
  done: boolean
  label: string
  /** Hash route of the page that completes the step. */
  route: string
}

interface Progress {
  /** The sender no longer shows the example data. */
  companyDone: boolean
  /** At least one document was downloaded. */
  documents: number
  /** A backup file was downloaded at least once. */
  lastBackup: string | null
}

/** "Getting started" on the start page: company details, first document, first backup. */
export function onboardingSteps({ companyDone, documents, lastBackup }: Progress): OnboardingStep[] {
  return [
    { id: 'company', done: companyDone, label: tr('Firmendaten eintragen', 'Enter company details'), route: 'sender' },
    { id: 'document', done: documents > 0, label: tr('Erstes Dokument erstellen', 'Create your first document'), route: 'invoice' },
    { id: 'backup', done: lastBackup !== null, label: tr('Erste Sicherung herunterladen', 'Download your first backup'), route: 'data' },
  ]
}

/** The checklist disappears once every step is done. */
export const onboardingOpen = (steps: OnboardingStep[]): boolean => steps.some((step) => !step.done)
