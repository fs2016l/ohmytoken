import type { AiEndpointResult, AiProbeEvidence, NetworkEndpoint } from '../../shared/network-check'
import { classifyEndpoint } from './ai-probes'
import { assessRegion, geminiPageRegion, regionCode } from './ai-regions'
import { publicIp } from './policy'
import { parseObject, type NetworkFetcher, type ProbeResponse } from './protocol'

const tracedEntries = new Set(['chatgpt-web', 'openai-api', 'claude-web', 'anthropic-api'])
const cookiePreflight = 'https://api.openai.com/compliance/cookie_requirements'

function evidence(
  kind: AiProbeEvidence['kind'],
  response: ProbeResponse,
  status: AiProbeEvidence['status'],
  now: number,
): AiProbeEvidence {
  return {
    kind,
    url: response.url,
    destination: response.destination,
    status,
    httpStatus: response.statusCode,
    elapsedMs: response.elapsedMs,
    checkedAt: response.observedAt ?? now,
    observedIp: null,
    country: null,
    issue: response.issue,
  }
}

function normalResponse(response: ProbeResponse): boolean {
  return (
    response.statusCode === 200 &&
    !response.issue &&
    !response.truncated &&
    !response.redirectStopped &&
    response.destination === response.url
  )
}

function readTrace(response: ProbeResponse): { ip: string; country: string } | null {
  if (!normalResponse(response)) return null
  const fields = new Map<string, string>()
  for (const line of response.body.trim().split(/\r?\n/)) {
    const match = line.match(/^([a-z_]+)=(.*)$/)
    if (!match || fields.has(match[1])) return null
    fields.set(match[1], match[2])
  }
  const ip = publicIp(fields.get('ip'))
  const country = regionCode(fields.get('loc') ?? '')
  if (!ip || !country || fields.get('h') !== new URL(response.url).hostname) return null
  return { ip, country }
}

/** 每个入口独立收集证据；API 不借用网页出口，地区推断不能覆盖明确的拒绝。 */
export async function inspectAiEndpoint(
  endpoint: NetworkEndpoint,
  fetch: NetworkFetcher,
  signal: AbortSignal,
  now: () => number,
): Promise<AiEndpointResult> {
  const primary = await fetch(endpoint.url, signal)
  let result = classifyEndpoint(endpoint, primary, now())
  result.evidence.push(evidence('entry', primary, result.status ?? 'unknown', now()))
  if (result.state !== 'done' || primary.statusCode === 429 || signal.aborted) return result

  if (endpoint.id === 'openai-api') {
    const response = await fetch(cookiePreflight, signal)
    const classified = classifyEndpoint(endpoint, response, now())
    const valid =
      normalResponse(response) &&
      typeof parseObject(response.body).cookie_consent_required === 'boolean'
    result.evidence.push(
      evidence(
        'preflight',
        response,
        valid ? 'accessible' : (classified.status ?? 'unknown'),
        now(),
      ),
    )
    if (['restricted', 'challenge', 'rate_limited'].includes(classified.status ?? '')) {
      result = {
        ...classified,
        id: endpoint.id,
        requiresAuth: result.requiresAuth,
        evidence: result.evidence,
      }
    }
    if (response.statusCode === 429 || signal.aborted) return result
  }

  if (tracedEntries.has(endpoint.id) && !signal.aborted) {
    const url = `${new URL(endpoint.url).origin}/cdn-cgi/trace`
    const response = await fetch(url, signal)
    const trace = readTrace(response)
    const item = evidence(
      'region_trace',
      response,
      trace ? 'accessible' : response.issue ? 'error' : 'unknown',
      now(),
    )
    if (trace) {
      item.observedIp = trace.ip
      item.country = trace.country
      result.region = assessRegion(endpoint.id, trace.country, 'edge')
    }
    result.evidence.push(item)
  }

  if (
    endpoint.id === 'gemini-web' &&
    primary.statusCode === 200 &&
    !primary.truncated &&
    new URL(primary.destination).hostname === 'gemini.google.com'
  ) {
    const country = geminiPageRegion(primary.body)
    if (country) {
      result.region = assessRegion(endpoint.id, country, 'page')
      result.evidence.push({ ...evidence('page_region', primary, 'reachable', now()), country })
    }
  }

  if (['accessible', 'reachable', 'authentication', 'unknown'].includes(result.status ?? '')) {
    if (result.region?.status === 'not_listed') {
      result.status = 'region_limited'
      result.reason = 'region_policy'
    } else if (
      result.region?.status === 'supported' &&
      ['accessible', 'reachable'].includes(result.status ?? '') &&
      (endpoint.id !== 'openai-api' ||
        result.evidence.some((item) => item.kind === 'preflight' && item.status === 'accessible'))
    ) {
      result.status = 'precheck_passed'
      result.reason = 'network_region_precheck'
    }
  }
  return result
}
