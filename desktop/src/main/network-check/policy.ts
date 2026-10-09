import { isIP } from 'node:net'
import { AI_NETWORK_SERVICES, DNS_PROBE_COUNT, type NetworkIssue } from '../../shared/network-check'

const officialHosts = new Set([
  ...AI_NETWORK_SERVICES.flatMap((service) =>
    service.endpoints.map((item) => new URL(item.url).hostname),
  ),
  'ipinfo.io',
  'api.ipapi.is',
  'ipwho.is',
  'proxycheck.io',
  'api.ipquery.io',
  'api.ip2location.io',
  'stat.ripe.net',
  'api.ipify.org',
  'api6.ipify.org',
  'auth.openai.com',
  'auth.anthropic.com',
  'www.anthropic.com',
  'accounts.google.com',
  'login.live.com',
  'login.microsoftonline.com',
  'accounts.x.ai',
])

/** 只允许本轮生成的 DNS 探测形状，不开放任意 IPLeak 子域名或路径。 */
export function isDnsProbeUrl(input: string): boolean {
  try {
    const url = new URL(input)
    const match = url.hostname.match(/^[a-f0-9]{40}-([1-9])\.ipleak\.net$/)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !!match &&
      Number(match[1]) <= DNS_PROBE_COUNT &&
      url.pathname === '/dnsdetection/' &&
      !url.search &&
      !url.hash
    )
  } catch {
    return false
  }
}

export function allowedNetworkUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      (officialHosts.has(url.hostname) || isDnsProbeUrl(input))
    )
  } catch {
    return false
  }
}

export function publicIp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const ip = value.trim()
  const family = isIP(ip)
  if (family === 4) {
    const [a, b] = ip.split('.').map(Number)
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    )
      return null
    return ip
  }
  // 仅接受全球单播 IPv6，排除 loopback、链路本地、ULA、映射 IPv4 和 zone id。
  if (family === 6 && /^[23][0-9a-f]{3}:/i.test(ip) && !ip.includes('%')) {
    return new URL(`https://[${ip}]/`).hostname.slice(1, -1)
  }
  return null
}

export function safeDestination(input: string): string {
  try {
    const url = new URL(input)
    return `${url.origin}${url.pathname}`.slice(0, 240)
  } catch {
    return ''
  }
}

export function connectionIssue(error: unknown, signal: AbortSignal): NetworkIssue {
  if (signal.aborted) return signal.reason === 'cancelled' ? 'cancelled' : 'timeout'
  const message = error instanceof Error ? error.message : String(error)
  if (/TIMED?_?OUT|TIMEOUT/i.test(message)) return 'timeout'
  if (/NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i.test(message)) return 'dns'
  if (/CERT_|SSL_|TLS|CERTIFICATE/i.test(message)) return 'tls'
  if (/PROXY_AUTH|407/i.test(message)) return 'proxy_auth'
  return 'connection'
}
