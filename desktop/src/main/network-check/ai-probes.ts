import type { AiEndpointResult, NetworkEndpoint } from '../../shared/network-check'
import { jsonObject, parseObject, type ProbeResponse } from './protocol'

export function emptyEndpoint(id: string): AiEndpointResult {
  return {
    id,
    state: 'pending',
    status: null,
    reason: null,
    httpStatus: null,
    elapsedMs: null,
    route: 'unknown',
    destination: null,
    issue: null,
    checkedAt: null,
    requiresAuth: false,
    retryAt: null,
    region: null,
    evidence: [],
  }
}

function errorText(root: Record<string, unknown>): string {
  // 仅检查错误对象，避免把模型元数据或正常网页里的示例错误误判成地区限制。
  if (!root.error && root.type !== 'error') return ''
  return JSON.stringify(root.error ?? root)
    .slice(0, 16_000)
    .toLowerCase()
}

function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const pageBrands: Record<string, RegExp> = {
  'chatgpt-web': /chatgpt|openai/i,
  'claude-web': /claude/i,
  'gemini-web': /gemini/i,
  'gemini-studio': /ai studio/i,
  'grok-web': /grok|xai/i,
  'copilot-web': /copilot/i,
}

export function classifyEndpoint(
  endpoint: NetworkEndpoint,
  response: ProbeResponse,
  now = Date.now(),
): AiEndpointResult {
  const result: AiEndpointResult = {
    ...emptyEndpoint(endpoint.id),
    state: 'done',
    status: 'unknown',
    reason: 'unexpected_response',
    httpStatus: response.statusCode,
    elapsedMs: response.elapsedMs,
    route: response.route,
    destination: response.destination,
    issue: response.issue,
    checkedAt: response.observedAt ?? now,
    retryAt: response.retryAt ?? null,
  }
  const set = (
    status: AiEndpointResult['status'],
    reason: AiEndpointResult['reason'],
  ): AiEndpointResult => ({ ...result, status, reason })
  if (response.issue)
    return {
      ...result,
      state: response.issue === 'cancelled' ? 'cancelled' : 'failed',
      status: 'error',
      reason: 'network_error',
    }
  const code = response.statusCode ?? 0
  const body = response.body
  const root = parseObject(body)
  const error = errorText(root)
  const title = body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''
  const visible = Object.keys(root).length === 0 && /<\w+\b/.test(body) ? visibleText(body) : ''
  const regionError =
    /unsupported_country(?:_region_territory)?|country_not_supported|region_not_supported|geo_blocked|location_not_supported|not available in (?:your|this) (?:country|region|location)|not supported in (?:your|this) (?:country|region)/i
  if (
    /\/(?:app-unavailable-in-region|unsupported-country|unsupported-region|not-available-in-region)(?:\/|$)/i.test(
      response.destination,
    )
  )
    return set('restricted', 'region_redirect')
  if (regionError.test(error) || (visible.length < 6000 && regionError.test(visible)))
    return set('restricted', 'region_response')
  if (
    /ip(?:_address)?_(?:not_authorized|not_allowed|blocked)|disallowed isp|ip.{0,30}(?:allowlist|not authorized)/i.test(
      error,
    )
  )
    return set('restricted', 'ip_denied')
  if (
    /^https:\/\/(?:www\.)?google\.com\/sorry(?:\/|$)/i.test(response.destination) ||
    response.headers['cf-mitigated'] === 'challenge' ||
    /just a moment|attention required|security verification|verify (?:that )?you are human|checking your browser|请稍候|請稍候|安全验证|安全驗證/i.test(
      title,
    ) ||
    /<(?:div|form)\b[^>]*\bid=["'](?:challenge-running|challenge-form|cf-challenge|challenge-stage)["']/i.test(
      body,
    )
  )
    return set('challenge', 'browser_verification')
  if (code === 429) return set('rate_limited', 'http_rate_limit')
  if (response.truncated) return set('unknown', 'response_incomplete')
  if (
    code === 401 ||
    /authentication_error|invalid_api_key|missing_api_key|api_key_invalid|unregistered callers|missing.*(?:authentication|api.key)|requires? (?:an? )?api.key/i.test(
      error,
    )
  )
    return {
      ...set(error && endpoint.kind === 'api' ? 'reachable' : 'authentication', 'auth_response'),
      requiresAuth: true,
    }
  if (
    /^https:\/\/(?:accounts\.google\.com|login\.live\.com|login\.microsoftonline\.com|auth\.openai\.com|auth\.anthropic\.com)(?:\/|$)/i.test(
      response.destination,
    ) ||
    /\/(?:login|signin|sign-in)(?:\/|$)/i.test(response.destination) ||
    /^(?:sign in|log in|login)[\s—–|-]/i.test(title.trim())
  )
    return {
      ...set(
        code >= 200 && code < 300 && pageBrands[endpoint.id]?.test(visibleText(title))
          ? 'reachable'
          : 'authentication',
        'login_required',
      ),
      requiresAuth: true,
    }
  if (response.redirectStopped) return set('unknown', 'redirect_unconfirmed')
  if (code === 403 || code === 451) return set('unknown', 'http_forbidden')
  if (code >= 200 && code < 300) {
    if (
      endpoint.kind === 'api' &&
      !root.error &&
      (Array.isArray(root.models) || Array.isArray(root.data) || jsonObject(root).object === 'list')
    )
      return set('accessible', 'api_received')
    if (endpoint.kind !== 'api' && pageBrands[endpoint.id]?.test(visibleText(title)))
      return set('accessible', 'page_received')
  }
  return result
}
