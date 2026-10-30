export type DiagnosticReportType = 'crash' | 'renderer' | 'update' | 'ipc' | 'manual'
export type DiagnosticSeverity = 'warning' | 'error' | 'fatal'

export interface DiagnosticRuntimeSnapshot {
  appVersion: string
  platform: string
  arch: string
  osVersion: string
  electronVersion: string
  environment: 'production' | 'development'
}

export interface DiagnosticErrorPayload {
  reportType?: DiagnosticReportType
  source: string
  stage?: string
  severity?: DiagnosticSeverity
  summary?: string
  message: string
  stack?: string
  context?: Record<string, unknown>
  occurredAt?: number
  /** Captured by the main process at occurrence time, including for delayed uploads. */
  runtime?: DiagnosticRuntimeSnapshot
}

export interface DiagnosticUploadOptions {
  reportType?: DiagnosticReportType
  source?: string
  stage?: string
  summary?: string
  note?: string
}

export interface DiagnosticUploadResult {
  id: number
}

export interface DiagnosticManualUploadResult {
  cancelled: boolean
  id?: number
}

export interface DiagnosticUploadState {
  canUpload: boolean
  uploadedReportId?: number
  uploadedAt?: number
}
