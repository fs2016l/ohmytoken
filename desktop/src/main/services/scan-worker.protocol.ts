import type { ScanOptions, ScanResult } from '../../shared/models'
import { isScanProgress, type ScanProgress } from '../../shared/scan-progress'

export interface ScanWorkerRequest {
  type: 'scan'
  requestId: number
  scanId: string
  options: ScanOptions
}

export interface ScanWorkerSuccess {
  type: 'scan-result'
  requestId: number
  result: ScanResult
}

export interface ScanWorkerFailure {
  type: 'scan-error'
  requestId: number
  error: string
}

export interface ScanWorkerProgress {
  type: 'scan-progress'
  requestId: number
  progress: ScanProgress
}

export type ScanWorkerResponse = ScanWorkerSuccess | ScanWorkerFailure | ScanWorkerProgress

export function isScanWorkerRequest(value: unknown): value is ScanWorkerRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<ScanWorkerRequest>
  if (request.type !== 'scan' || !Number.isSafeInteger(request.requestId)) return false
  if (typeof request.scanId !== 'string' || !request.scanId) return false
  if (!request.options || typeof request.options !== 'object') return false
  return request.options.mode === 'incremental' || request.options.mode === 'full'
}

export function isScanWorkerResponse(value: unknown): value is ScanWorkerResponse {
  if (!value || typeof value !== 'object') return false
  const response = value as Partial<ScanWorkerResponse>
  if (!Number.isSafeInteger(response.requestId)) return false
  if (response.type === 'scan-progress') return isScanProgress(response.progress)
  if (response.type === 'scan-error') return typeof response.error === 'string'
  return response.type === 'scan-result' && Boolean(response.result)
}
