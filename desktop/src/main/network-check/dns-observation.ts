import { randomBytes } from 'node:crypto'
import { DNS_PROBE_COUNT, type DnsObservation } from '../../shared/network-check'
import { connectionIssue, publicIp } from './policy'
import { jsonObject, parseObject, requestIssue, type NetworkFetcher } from './protocol'

export function emptyDnsObservation(): DnsObservation {
  return {
    state: 'pending',
    resolvers: [],
    completedProbes: 0,
    route: 'unknown',
    observedAt: null,
    issue: null,
    retryAt: null,
    geolocation: {
      state: 'pending',
      exit: null,
      locations: [],
      observedAt: null,
      issue: null,
      retryAt: null,
    },
  }
}

/** 观察权威端实际收到查询的递归解析器，不根据地址或数量判断是否泄漏。 */
export async function inspectDns(
  fetch: NetworkFetcher,
  signal: AbortSignal,
  now: () => number = Date.now,
  onProgress?: (result: DnsObservation) => void,
): Promise<DnsObservation> {
  const result = { ...emptyDnsObservation(), state: 'checking' as DnsObservation['state'] }
  const session = randomBytes(20).toString('hex')
  const resolvers = new Map<string, number>()
  const routes = new Set<DnsObservation['route']>()
  for (let step = 1; step <= DNS_PROBE_COUNT; step++) {
    if (signal.aborted) {
      result.issue = connectionIssue('', signal)
      break
    }
    try {
      const url = `https://${session}-${step}.ipleak.net/dnsdetection/`
      const response = await fetch(url, signal)
      result.issue = requestIssue(response)
      result.retryAt = response.retryAt ?? null
      if (result.issue) break
      const data = parseObject(response.body)
      if (
        response.truncated ||
        response.redirectStopped ||
        response.destination !== url ||
        !data.ip ||
        typeof data.ip !== 'object' ||
        Array.isArray(data.ip)
      ) {
        result.issue = 'invalid_response'
        break
      }
      const entries = Object.entries(jsonObject(data.ip))
      if (
        entries.length > 64 ||
        entries.some(
          ([ip, count]) => !publicIp(ip) || !Number.isSafeInteger(count) || (count as number) <= 0,
        )
      ) {
        result.issue = 'invalid_response'
        break
      }
      for (const [ip, count] of entries) {
        const normalized = publicIp(ip)!
        // 来源会返回会话累计命中数；重复轮次取最大值，避免把累计值再次相加。
        resolvers.set(normalized, Math.max(resolvers.get(normalized) ?? 0, count as number))
      }
      if (resolvers.size > 64) {
        result.issue = 'invalid_response'
        break
      }
      result.resolvers = [...resolvers].map(([ip, hits]) => ({ ip, hits }))
      result.completedProbes++
      routes.add(response.route)
      result.route = routes.size === 1 ? response.route : 'unknown'
      result.observedAt = response.observedAt ?? now()
      onProgress?.(structuredClone(result))
    } catch (error) {
      result.issue = connectionIssue(error, signal)
      break
    }
  }
  if (signal.aborted) result.issue = connectionIssue('', signal)
  result.state = result.issue === 'cancelled' ? 'cancelled' : result.issue ? 'failed' : 'done'
  return result
}
