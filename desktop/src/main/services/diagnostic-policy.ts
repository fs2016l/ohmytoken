import type { DiagnosticSeverity } from '../../shared/diagnostics'

export interface ProcessExitDetails {
  reason: string
  exitCode: number
  type?: string
  serviceName?: string
  name?: string
}

/** Only confirmed shutdowns are quiet; an unexplained kill remains actionable. */
export function classifyProcessExit(
  details: ProcessExitDetails,
  platform: string,
  shuttingDown: boolean,
): { category: string; severity: DiagnosticSeverity; unexpected: boolean } {
  if (details.reason === 'clean-exit')
    return { category: 'clean-exit', severity: 'warning', unexpected: false }
  if (shuttingDown || (platform === 'win32' && details.exitCode >>> 0 === 0xc000026b))
    return { category: 'shutdown', severity: 'warning', unexpected: false }
  return {
    category: details.reason === 'killed' ? 'terminated' : 'process-failure',
    severity: details.reason === 'crashed' ? 'fatal' : 'error',
    unexpected: true,
  }
}
