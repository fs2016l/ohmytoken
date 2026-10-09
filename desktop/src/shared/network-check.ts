export type NetworkMode = 'system' | 'direct'
export type AiNetworkServiceId = 'openai' | 'anthropic' | 'google' | 'xai' | 'copilot'
export type NetworkCheckTarget = 'all' | 'ip' | 'dns' | AiNetworkServiceId
export type CheckState = 'pending' | 'checking' | 'done' | 'failed' | 'cancelled'
export type NetworkIssue =
  | 'timeout'
  | 'dns'
  | 'tls'
  | 'connection'
  | 'proxy_auth'
  | 'rate_limited'
  | 'authentication'
  | 'invalid_response'
  | 'unavailable'
  | 'cancelled'
  | 'no_ip'
export type AccessStatus =
  | 'accessible'
  | 'precheck_passed'
  | 'reachable'
  | 'region_limited'
  | 'restricted'
  | 'challenge'
  | 'authentication'
  | 'rate_limited'
  | 'unknown'
  | 'error'
export type AccessReason =
  | 'page_received'
  | 'api_received'
  | 'region_response'
  | 'region_redirect'
  | 'browser_verification'
  | 'login_required'
  | 'http_rate_limit'
  | 'http_forbidden'
  | 'unexpected_response'
  | 'redirect_unconfirmed'
  | 'network_error'
  | 'network_region_precheck'
  | 'region_policy'
  | 'auth_response'
  | 'ip_denied'
  | 'response_incomplete'
export type NetworkType = 'residential' | 'hosting' | 'business' | 'mobile' | 'education' | 'isp'
export type RiskFactor =
  'proxy' | 'tor' | 'vpn' | 'hosting' | 'abuse' | 'robot' | 'compromised' | 'mobile'

export interface IpQualityResult {
  id: string
  state: CheckState
  ip: string | null
  country: string | null
  countryCode: string | null
  region: string | null
  city: string | null
  asn: string | null
  organization: string | null
  companyName: string | null
  timezone: string | null
  postalCode: string | null
  usageType: NetworkType | null
  companyType: NetworkType | null
  riskScore: number | null
  sourceUpdatedAt: number | null
  factors: Record<RiskFactor, boolean | null>
  observedAt: number | null
  cached: boolean
  issue: NetworkIssue | null
}

export interface IpRegistrationResult {
  state: CheckState
  ip: string | null
  countries: string[]
  registries: string[]
  observedAt: number | null
  cached: boolean
  issue: NetworkIssue | null
}

export interface ExitObservation {
  state: CheckState
  ip: string | null
  source: string
  route: 'direct' | 'proxy' | 'unknown'
  issue: NetworkIssue | null
}

export const DNS_PROBE_COUNT = 3

export interface DnsIpLocation {
  ip: string
  countryCode: string | null
  asn: string | null
  organization: string | null
}

export interface DnsGeolocation {
  state: CheckState
  exit: ExitObservation | null
  locations: DnsIpLocation[]
  observedAt: number | null
  issue: NetworkIssue | null
  retryAt: number | null
}

export interface DnsObservation {
  state: CheckState
  resolvers: Array<{ ip: string; hits: number }>
  completedProbes: number
  route: ExitObservation['route']
  observedAt: number | null
  issue: NetworkIssue | null
  retryAt: number | null
  geolocation: DnsGeolocation
}

export interface AiEndpointResult {
  id: string
  state: CheckState
  status: AccessStatus | null
  reason: AccessReason | null
  httpStatus: number | null
  elapsedMs: number | null
  route: 'direct' | 'proxy' | 'unknown'
  destination: string | null
  issue: NetworkIssue | null
  checkedAt: number | null
  requiresAuth: boolean
  retryAt: number | null
  region: AiRegionObservation | null
  evidence: AiProbeEvidence[]
}

export interface AiRegionObservation {
  country: string
  source: 'edge' | 'page'
  status: 'supported' | 'not_listed' | 'conditional'
  policyUrl: string
  reviewedAt: string
}

export interface AiProbeEvidence {
  kind: 'entry' | 'region_trace' | 'preflight' | 'page_region'
  url: string
  destination: string
  status: AccessStatus
  httpStatus: number | null
  elapsedMs: number
  checkedAt: number
  observedIp: string | null
  country: string | null
  issue: NetworkIssue | null
}

export interface NetworkCheckSnapshot {
  revision: number
  runId: number
  status: 'idle' | 'running' | 'completed' | 'cancelled'
  cancelling: boolean
  mode: NetworkMode
  target?: NetworkCheckTarget
  issue?: NetworkIssue | null
  startedAt: number | null
  finishedAt: number | null
  completed: number
  total: number
  exit: ExitObservation
  ipv6: ExitObservation
  dns: DnsObservation
  registration: IpRegistrationResult
  sources: IpQualityResult[]
  endpoints: AiEndpointResult[]
}

export interface NetworkEndpoint {
  id: string
  kind: 'web' | 'api' | 'studio'
  url: string
}

export interface AiNetworkService {
  id: AiNetworkServiceId
  name: string
  mark: string
  descriptionZh: string
  descriptionEn: string
  endpoints: NetworkEndpoint[]
}

// 服务入口独立配置。这里只定义匿名访问范围，不包含模型调用和账户凭据。
export const AI_NETWORK_SERVICES: readonly AiNetworkService[] = [
  {
    id: 'openai',
    name: 'ChatGPT / OpenAI',
    mark: 'GPT',
    descriptionZh: '分别检查 ChatGPT 网页与 OpenAI API。Codex 登录、套餐和具体模型权限未验证。',
    descriptionEn:
      'Checks ChatGPT web and OpenAI API separately. Codex sign-in, plans and model permissions are not verified.',
    endpoints: [
      { id: 'chatgpt-web', kind: 'web', url: 'https://chatgpt.com/' },
      { id: 'openai-api', kind: 'api', url: 'https://api.openai.com/v1/models' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Claude',
    mark: 'CL',
    descriptionZh: '检查 Claude 网页与 Anthropic API。Claude Code 会话和模型调用权限未验证。',
    descriptionEn:
      'Checks Claude web and Anthropic API. Claude Code sessions and model permissions are not verified.',
    endpoints: [
      { id: 'claude-web', kind: 'web', url: 'https://claude.ai/' },
      { id: 'anthropic-api', kind: 'api', url: 'https://api.anthropic.com/v1/models' },
    ],
  },
  {
    id: 'google',
    name: 'Gemini',
    mark: 'GE',
    descriptionZh: '分别检查 Gemini 网页、AI Studio 与 API。Google 账号条件和 Gemini CLI 未验证。',
    descriptionEn:
      'Checks Gemini web, AI Studio and API separately. Google account eligibility and Gemini CLI are not verified.',
    endpoints: [
      { id: 'gemini-web', kind: 'web', url: 'https://gemini.google.com/' },
      { id: 'gemini-studio', kind: 'studio', url: 'https://aistudio.google.com/' },
      {
        id: 'gemini-api',
        kind: 'api',
        url: 'https://generativelanguage.googleapis.com/v1beta/models',
      },
    ],
  },
  {
    id: 'xai',
    name: 'Grok / xAI',
    mark: 'GR',
    descriptionZh: '检查 Grok 网页与 xAI API。X 账号、订阅和 Grok CLI 未验证。',
    descriptionEn:
      'Checks Grok web and xAI API. X accounts, subscriptions and Grok CLI are not verified.',
    endpoints: [
      { id: 'grok-web', kind: 'web', url: 'https://grok.com/' },
      { id: 'xai-api', kind: 'api', url: 'https://api.x.ai/v1/models' },
    ],
  },
  {
    id: 'copilot',
    name: 'Microsoft Copilot',
    mark: 'CO',
    descriptionZh: '检查 Microsoft Copilot 网页入口；GitHub Copilot 是独立服务，不包含在此结果中。',
    descriptionEn:
      'Checks Microsoft Copilot web. GitHub Copilot is a separate service and is not covered.',
    endpoints: [{ id: 'copilot-web', kind: 'web', url: 'https://copilot.microsoft.com/' }],
  },
]

export const IP_QUALITY_SOURCES = [
  {
    id: 'ipinfo',
    name: 'IPinfo',
    riskData: false,
    url: 'https://ipinfo.io/developers',
    noteZh: '官方免 Token 基础接口；不提供付费隐私标签和风险分。',
    noteEn:
      'Official token-free basic endpoint. Paid privacy labels and risk scores are not included.',
  },
  {
    id: 'ipapi',
    name: 'ipapi.is',
    riskData: false,
    url: 'https://ipapi.is/developers.html',
    noteZh: '官方匿名接口提供基础信息；代理、VPN、Tor、机房和滥用标签需要 API Key。',
    noteEn:
      'The official anonymous API provides basic information. Proxy, VPN, Tor, hosting and abuse labels require an API key.',
  },
  {
    id: 'ipwhois',
    name: 'IPWHOIS',
    riskData: false,
    url: 'https://ipwhois.io/documentation',
    noteZh: '官方免 Key 归属地接口；安全标签不属于免费范围。',
    noteEn:
      'Official key-free geolocation endpoint. Security labels are not part of the free tier.',
  },
  {
    id: 'proxycheck',
    name: 'ProxyCheck',
    riskData: true,
    url: 'https://proxycheck.io/api/',
    noteZh: '官方匿名接口，每日额度有限；风险分为该来源的 0–100 分，并非 AI 厂商风控分。',
    noteEn:
      'Official anonymous API with a daily limit. Its 0–100 risk score is not an AI provider risk score.',
  },
  {
    id: 'ipquery',
    name: 'IPQuery',
    riskData: true,
    url: 'https://ipquery.io/',
    noteZh:
      '官方免费免 Key API；提供代理、VPN、Tor、机房、移动网络标记及独立的 0–100 风险分。未提供公司类型、滥用、爬虫或遭入侵记录。',
    noteEn:
      'Official free API without an API key. Provides proxy, VPN, Tor, hosting and mobile flags, plus its own 0–100 risk score. Company types, abuse, scraper and compromised records are not provided.',
  },
  {
    id: 'ip2location',
    name: 'IP2Location.io',
    riskData: true,
    url: 'https://www.ip2location.io/ip2location-documentation',
    noteZh:
      '官方免 Key 接口，每日最多 1,000 次查询。提供定位、ASN 和公开代理（PUB）标记；代理为否不排除 VPN、Tor 或其他代理，风险分和详细类型不在免费范围。',
    noteEn:
      'Official keyless API, up to 1,000 queries daily. Provides geolocation, ASN and public proxy (PUB) detection. A negative proxy flag does not rule out VPN, Tor or other proxies. Risk scores and detailed types are outside this free tier.',
  },
] as const
