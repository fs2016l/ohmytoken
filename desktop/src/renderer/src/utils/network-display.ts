import {
  IP_QUALITY_SOURCES,
  type AiEndpointResult,
  type IpQualityResult,
} from '@shared/network-check'
export const isNetworkPassed = (result?: AiEndpointResult): boolean =>
  result?.state === 'done' && ['accessible', 'precheck_passed'].includes(result.status ?? '')
export const networkNeedsAttention = (result?: AiEndpointResult): boolean =>
  Boolean(
    result && (result.state === 'failed' || (result.state === 'done' && !isNetworkPassed(result))),
  )
export function networkRiskSources(sources: IpQualityResult[]) {
  const scored = sources.filter((source) => source.riskScore != null)
  const primary = scored.find((source) => source.id === 'proxycheck') ?? scored[0]
  return { primary, other: scored.find((source) => source.id !== primary?.id) }
}
export const networkSourceName = (id?: string): string =>
  IP_QUALITY_SOURCES.find((source) => source.id === id)?.name ?? '—'
export const maskedIp = (ip?: string | null): string =>
  !ip
    ? '—'
    : ip.includes(':')
      ? `${ip.split(':').slice(0, 2).join(':')}:…`
      : `${ip.split('.').slice(0, 2).join('.')}.*.*`
