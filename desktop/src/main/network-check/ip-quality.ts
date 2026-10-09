import type { IpQualityResult, NetworkType } from '../../shared/network-check'
import { regionCode } from './ai-regions'
import { publicIp } from './policy'
import {
  booleanField,
  jsonObject,
  parseObject,
  requestIssue,
  textField,
  type ProbeResponse,
} from './protocol'

export function emptyIpQuality(id: string): IpQualityResult {
  return {
    id,
    state: 'pending',
    ip: null,
    country: null,
    countryCode: null,
    region: null,
    city: null,
    asn: null,
    organization: null,
    companyName: null,
    timezone: null,
    postalCode: null,
    usageType: null,
    companyType: null,
    riskScore: null,
    sourceUpdatedAt: null,
    factors: {
      proxy: null,
      tor: null,
      vpn: null,
      hosting: null,
      abuse: null,
      robot: null,
      compromised: null,
      mobile: null,
    },
    observedAt: null,
    cached: false,
    issue: null,
  }
}

function networkType(value: unknown): NetworkType | null {
  const key = textField(value)?.toLowerCase()
  const types: Record<string, NetworkType> = {
    residential: 'residential',
    hosting: 'hosting',
    business: 'business',
    wireless: 'mobile',
    mobile: 'mobile',
    education: 'education',
    edu: 'education',
    isp: 'isp',
  }
  return key ? (types[key] ?? null) : null
}

function asn(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return `AS${value}`
  const text = textField(value)
  return text?.match(/^(?:AS)?(\d+)(?:\s|$)/i)?.[1] ? `AS${text.match(/^(?:AS)?(\d+)/i)![1]}` : null
}

function score(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null
}

function updatedAt(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

/** 所有字段都来自响应；缺失、null 或字符串布尔值均不当作 false。 */
export function parseIpQuality(
  id: string,
  response: ProbeResponse,
  target: string | null,
  now = Date.now(),
): IpQualityResult {
  const result = emptyIpQuality(id)
  const root = parseObject(response.body)
  result.issue =
    requestIssue(response) ??
    (response.truncated || response.redirectStopped ? 'invalid_response' : null)
  // 本适配器不传 Key；官方的 Key/额度合并错误在这里表示免 Key 查询额度受限。
  if (
    id === 'ip2location' &&
    !response.issue &&
    !response.truncated &&
    !response.redirectStopped &&
    jsonObject(root.error).error_code === 10000
  )
    result.issue = 'rate_limited'
  result.observedAt = now
  if (result.issue) {
    result.state = result.issue === 'cancelled' ? 'cancelled' : 'failed'
    return result
  }
  const data =
    id === 'proxycheck'
      ? jsonObject(Object.entries(root).find(([key]) => publicIp(key) === target)?.[1])
      : root
  const address = id === 'proxycheck' ? target : publicIp(data.ip)
  if (
    !address ||
    (target !== null && address !== target) ||
    !Object.keys(data).length ||
    data.success === false ||
    root.error ||
    (id === 'proxycheck' && !['ok', 'warning'].includes(String(root.status)))
  ) {
    result.state = 'failed'
    result.issue = /limit|quota|exhaust/i.test(String(root.message ?? root.error ?? ''))
      ? 'rate_limited'
      : 'invalid_response'
    return result
  }
  result.state = 'done'
  result.ip = address
  if (id === 'ipinfo') {
    const allocation = jsonObject(data.asn)
    const company = jsonObject(data.company)
    const privacy = jsonObject(data.privacy)
    const organization = textField(data.org)
    result.country = textField(data.country)
    result.region = textField(data.region)
    result.city = textField(data.city)
    result.asn = asn(allocation.asn ?? organization)
    result.organization =
      textField(allocation.name) ?? organization?.replace(/^AS\d+\s+/, '') ?? null
    result.timezone = textField(data.timezone)
    result.companyName = textField(company.name)
    result.postalCode = textField(data.postal)
    result.usageType = networkType(allocation.type)
    result.companyType = networkType(company.type)
    for (const key of ['proxy', 'vpn', 'tor', 'hosting'] as const)
      result.factors[key] = booleanField(privacy[key])
    result.factors.mobile = booleanField(data.is_mobile)
  } else if (id === 'ipapi') {
    const location = jsonObject(data.location)
    const company = jsonObject(data.company)
    const allocation = jsonObject(data.asn)
    result.country = textField(location.country_code ?? data.country)
    result.region = textField(location.state ?? data.region)
    result.city = textField(location.city ?? data.city)
    result.timezone = textField(location.timezone ?? data.timezone)
    result.asn = asn(allocation.asn ?? data.asn)
    result.organization = textField(allocation.org ?? company.name ?? data.company)
    result.companyName = textField(company.name ?? data.company)
    result.postalCode = textField(location.zip)
    result.usageType = networkType(allocation.type)
    result.companyType = networkType(company.type)
    result.factors = {
      proxy: booleanField(data.is_proxy),
      tor: booleanField(data.is_tor),
      vpn: booleanField(data.is_vpn),
      hosting: booleanField(data.is_datacenter),
      abuse: booleanField(data.is_abuser),
      robot: booleanField(data.is_crawler),
      compromised: null,
      mobile: booleanField(data.is_mobile),
    }
  } else if (id === 'ipwhois') {
    const connection = jsonObject(data.connection)
    result.country = textField(data.country_code)
    result.region = textField(data.region)
    result.city = textField(data.city)
    result.asn = asn(connection.asn)
    result.organization = textField(connection.org ?? connection.isp)
    result.timezone = textField(jsonObject(data.timezone).id)
    result.postalCode = textField(data.postal)
  } else if (id === 'proxycheck') {
    const network = jsonObject(data.network)
    const location = jsonObject(data.location)
    const detection = jsonObject(data.detections)
    result.country = textField(location.country_code)
    result.region = textField(location.region_name)
    result.city = textField(location.city_name)
    result.timezone = textField(location.timezone)
    result.asn = asn(network.asn)
    result.organization = textField(network.provider ?? network.organisation)
    result.companyName = textField(network.organisation)
    result.postalCode = textField(location.postal_code)
    result.usageType = networkType(network.type)
    result.riskScore = score(detection.risk)
    result.sourceUpdatedAt = updatedAt(data.last_updated)
    for (const key of ['proxy', 'vpn', 'tor', 'hosting', 'compromised'] as const)
      result.factors[key] = booleanField(detection[key])
    result.factors.robot = booleanField(detection.scraper)
    const attacks = Object.values(jsonObject(data.attack_history))
    result.factors.abuse = attacks.some((count) => typeof count === 'number' && count > 0)
      ? true
      : null
  } else if (id === 'ipquery') {
    const location = jsonObject(data.location)
    const provider = jsonObject(data.isp)
    const risk = jsonObject(data.risk)
    result.country = textField(location.country_code ?? location.country)
    result.region = textField(location.state)
    result.city = textField(location.city)
    result.timezone = textField(location.timezone)
    result.postalCode = textField(location.zipcode)
    result.asn = asn(provider.asn)
    result.organization = textField(provider.isp ?? provider.org)
    result.riskScore = score(risk.risk_score)
    result.factors.proxy = booleanField(risk.is_proxy)
    result.factors.vpn = booleanField(risk.is_vpn)
    result.factors.tor = booleanField(risk.is_tor)
    result.factors.hosting = booleanField(risk.is_datacenter)
    result.factors.mobile = booleanField(risk.is_mobile)
  } else if (id === 'ip2location') {
    const field = (value: unknown): string | null => {
      const text = textField(value)
      return text === '-' ? null : text
    }
    result.country = field(data.country_code)
    result.region = field(data.region_name)
    result.city = field(data.city_name)
    result.asn = data.asn === '0' ? null : asn(data.asn)
    result.organization = field(data.as)
    result.timezone = field(data.time_zone)
    result.postalCode = field(data.zip_code)
    // 免费接口只识别公开代理 PUB，界面必须同时显示这一范围。
    result.factors.proxy = booleanField(data.is_proxy)
  }
  result.countryCode = regionCode(result.country ?? '')
  return result
}

export function ipQualityUrl(id: string, ip: string): string {
  if (!publicIp(ip)) throw new Error('Invalid public IP')
  const address = encodeURIComponent(ip)
  switch (id) {
    case 'ipapi':
      return `https://api.ipapi.is/?q=${address}`
    case 'ipwhois':
      return `https://ipwho.is/${address}`
    case 'proxycheck':
      return `https://proxycheck.io/v3/${address}?tag=0&ver=24-June-2026`
    case 'ipquery':
      return `https://api.ipquery.io/${address}`
    case 'ip2location':
      return `https://api.ip2location.io/?ip=${address}&format=json`
    default:
      throw new Error('Unknown IP source')
  }
}
