import type {
  DnsGeolocation,
  DnsIpLocation,
  DnsObservation,
  ExitObservation,
} from '../../shared/network-check'
import { ipQualityUrl, parseIpQuality } from './ip-quality'
import { connectionIssue, publicIp } from './policy'
import type { NetworkFetcher } from './protocol'

const LOOKUP_CONCURRENCY = 3

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
  // IPQuery 已停用批量查询，只能逐个查询；任一地址失败即不再派发剩余请求。
  const queue = [...addresses] as string[]
  const located = new Map<string, DnsIpLocation>()
  const pending = (): boolean => !result.issue && !signal.aborted && queue.length > 0
  const lookup = async (): Promise<void> => {
    const ip = queue.shift()!
    try {
      const url = ipQualityUrl('ipquery', ip)
      const response = await fetch(url, signal)
      const observedAt = response.observedAt ?? now()
      result.observedAt = Math.max(result.observedAt ?? 0, observedAt)
      if (result.issue) return
      const location = parseIpQuality('ipquery', response, ip, observedAt)
      if (location.issue) {
        result.issue = location.issue
        result.retryAt = response.retryAt ?? null
      } else if (response.destination !== url) {
        result.issue = 'invalid_response'
      } else {
        located.set(ip, {
          ip,
          countryCode: location.countryCode,
          asn: location.asn,
          organization: location.organization,
        })
      }
    } catch (error) {
      result.issue ??= connectionIssue(error, signal)
    }
  }
  // 首个请求单独发出：来源限流或不可用时只消耗一次请求。
  if (pending()) await lookup()
  await Promise.all(
    Array.from({ length: LOOKUP_CONCURRENCY }, async () => {
      while (pending()) await lookup()
    }),
  )
  if (signal.aborted) result.issue = connectionIssue('', signal)
  // 任一地址无法验证时不提供部分判断依据，原始 DNS 观测由调用方保留。
  result.locations = result.issue ? [] : addresses.map((ip) => located.get(ip!)!)
  result.state = result.issue === 'cancelled' ? 'cancelled' : result.issue ? 'failed' : 'done'
  return result
}
