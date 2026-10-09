import type { DnsGeolocation, DnsObservation, ExitObservation } from '../../shared/network-check'
import { parseIpQuality } from './ip-quality'
import { connectionIssue, publicIp } from './policy'
import { requestIssue, type NetworkFetcher } from './protocol'

/** 同一来源、同一轮查询出口和解析器地区；不把地理差异解释为隧道泄漏证据。 */
export async function inspectDnsGeolocation(
  dns: DnsObservation,
  exit: ExitObservation,
  fetch: NetworkFetcher,
  signal: AbortSignal,
  now: () => number = Date.now,
): Promise<DnsGeolocation> {
  const result: DnsGeolocation = {
    state: 'checking',
    exit: { ...exit },
    locations: [],
    observedAt: null,
    issue: null,
    retryAt: null,
  }
  if (!dns.resolvers.length && !signal.aborted) return { ...result, state: 'done' }
  const addresses = [...new Set([exit.ip, ...dns.resolvers.map((resolver) => resolver.ip)])]
    .filter((ip): ip is string => ip !== null)
    .map((ip) => publicIp(ip))
  if (addresses.length > 65 || addresses.some((ip) => !ip)) {
    return { ...result, state: 'failed', issue: 'invalid_response' }
  }
  try {
    if (signal.aborted) throw new Error('Aborted')
    const url = `https://api.ipquery.io/${addresses.map((ip) => encodeURIComponent(ip!)).join(',')}`
    const response = await fetch(url, signal)
    result.observedAt = response.observedAt ?? now()
    result.retryAt = response.retryAt ?? null
    result.issue = requestIssue(response)
    if (signal.aborted) throw new Error('Aborted')
    if (!result.issue) {
      if (response.truncated || response.redirectStopped || response.destination !== url) {
        result.issue = 'invalid_response'
      } else {
        const data: unknown = JSON.parse(response.body)
        const entries = Array.isArray(data) ? data : [data]
        const seen = new Set<string>()
        if (entries.length > addresses.length) result.issue = 'invalid_response'
        for (const entry of entries) {
          if (result.issue) break
          const location = parseIpQuality(
            'ipquery',
            { ...response, body: JSON.stringify(entry) },
            null,
            result.observedAt,
          )
          if (
            location.state !== 'done' ||
            !location.ip ||
            !addresses.includes(location.ip) ||
            seen.has(location.ip)
          ) {
            result.issue = 'invalid_response'
            break
          }
          seen.add(location.ip)
          result.locations.push({
            ip: location.ip,
            countryCode: location.countryCode,
            asn: location.asn,
            organization: location.organization,
          })
        }
      }
    }
  } catch (error) {
    result.issue =
      error instanceof SyntaxError ? 'invalid_response' : connectionIssue(error, signal)
  }
  // 无法验证的批量响应不提供任何判断依据，原始 DNS 观测由调用方保留。
  if (result.issue) result.locations = []
  result.state = result.issue === 'cancelled' ? 'cancelled' : result.issue ? 'failed' : 'done'
  return result
}
