import type { ServerIssue } from './apiErrors'

/** The backend rejected the document data; `issues` point at the faulty form fields. */
export class ValidationError extends Error {
  readonly issues: ServerIssue[]

  constructor(message: string, issues: ServerIssue[]) {
    super(message)
    this.name = 'ValidationError'
    this.issues = issues
  }
}

/** Error of the backend with its stable error code (`postage_disabled`, `validation_error`, …). */
export class ApiError extends Error {
  readonly code: string | undefined
  readonly details: string | undefined

  constructor(message: string, code?: string, details?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.details = details
  }
}
