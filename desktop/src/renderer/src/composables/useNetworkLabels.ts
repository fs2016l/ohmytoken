import type {
  AccessReason,
  AccessStatus,
  CheckState,
  NetworkIssue,
  NetworkType,
} from '../../../shared/network-check'
import { useI18n } from '../i18n/useI18n'
import { formatDateTime } from '../utils/date-time'

const accessLabels: Record<AccessStatus, [string, string]> = {
  accessible: ['Entry accessible', '入口可访问'],
  precheck_passed: ['Network precheck passed', '网络预检通过'],
  reachable: ['Network reachable', '网络可达'],
  region_limited: ['Outside listed regions', '未在公开支持范围'],
  restricted: ['Region restricted', '地区受限'],
  challenge: ['Verification required', '验证拦截'],
  authentication: ['Authentication required', '需要认证'],
  rate_limited: ['Limited by service', '服务方限流'],
  unknown: ['Unconfirmed', '待确认'],
  error: ['Connection failed', '连接失败'],
}
const reasons: Record<AccessReason, [string, string]> = {
  network_region_precheck: [
    'The entry responded normally and its observed region is supported. This is a network precheck, based on combined evidence.',
    '入口响应正常，观测地区在官方支持范围内；这是结合多项证据的网络预检结论。',
  ],
  region_policy: [
    'The observed region is not in this product’s published supported regions. This is a policy-based assessment.',
    '观测地区未列入该入口的官方支持范围；此结论依据公开地区政策推断。',
  ],
  auth_response: [
    'The request reached an authentication response. This alone does not confirm regional eligibility.',
    '请求已到达鉴权响应环节；单凭此响应不能确认地区支持。',
  ],
  ip_denied: [
    'The service explicitly refused the request IP or its network provider.',
    '服务明确拒绝了当前请求 IP 或其网络运营商。',
  ],
  response_incomplete: [
    'The response exceeded the inspection limit; no availability conclusion was drawn from incomplete content.',
    '响应超过检测读取范围，未根据不完整内容判定可用。',
  ],
  page_received: [
    'The service page responded normally. Account and model access are not verified.',
    '服务页面正常响应；账号与模型调用能力未验证。',
  ],
  api_received: [
    'The API returned its expected structure. Model generation is not verified.',
    'API 返回预期结构；模型生成能力未验证。',
  ],
  region_response: [
    'The response explicitly says this location is not supported.',
    '响应明确提示当前国家或地区不受支持。',
  ],
  region_redirect: [
    'The service redirected to a regional restriction page.',
    '服务跳转到了地区限制页面。',
  ],
  browser_verification: [
    'The service requested browser or human verification. This is not proof of an IP ban.',
    '服务要求浏览器或人机验证，不能据此认定 IP 已被封禁。',
  ],
  login_required: [
    'The sign-in entry responded. Sign-in requirements are shown separately from network conditions.',
    '登录入口已响应，账号要求与网络条件分别说明。',
  ],
  http_rate_limit: [
    'The service limited this request. Only this entry is paused; other checks can run normally.',
    '服务方限制了本次请求，仅暂缓该入口；其他项目可正常检测。',
  ],
  http_forbidden: [
    'Access was denied without clear regional evidence. The cause is unconfirmed.',
    '服务拒绝访问，但没有明确的地区限制证据，原因待确认。',
  ],
  unexpected_response: [
    'The response does not match a known service page or API response.',
    '响应不符合预期页面或接口结构，暂不判断是否支持。',
  ],
  redirect_unconfirmed: [
    'The redirect could not be confirmed as a supported service entry.',
    '跳转目标尚不能确认为受支持的服务入口。',
  ],
  network_error: ['The request could not be completed.', '网络请求未能完成。'],
}
const issues: Record<NetworkIssue, [string, string]> = {
  timeout: ['Request timed out', '请求超时'],
  dns: ['DNS lookup failed', '域名解析失败'],
  tls: ['Secure connection failed', '安全连接失败'],
  connection: ['Could not connect', '无法建立连接'],
  proxy_auth: ['Proxy authentication required', '代理需要认证'],
  rate_limited: [
    'This source limited the requests or quota for your exit IP',
    '当前出口在此数据源的额度或请求频率受限',
  ],
  authentication: ['This endpoint requires authentication', '该接口当前需要认证'],
  invalid_response: ['No valid data returned', '未返回有效数据'],
  unavailable: ['Source temporarily unavailable', '数据源暂不可用'],
  cancelled: ['Cancelled', '已取消'],
  no_ip: ['No public exit IP detected', '未获取到公网出口 IP'],
}
const types: Record<NetworkType, [string, string]> = {
  residential: ['Residential', '住宅'],
  hosting: ['Hosting', '机房'],
  business: ['Business', '商业'],
  mobile: ['Mobile / wireless', '移动 / 无线'],
  education: ['Education', '教育'],
  isp: ['ISP', '运营商'],
}

export function useNetworkLabels() {
  const { label, currentLang } = useI18n()
  const pair = (value: [string, string]): string => label(...value)
  const stateText = (state?: CheckState): string => {
    if (state === 'checking') return label('Checking…', '检测中…')
    if (state === 'done') return label('Responded', '已返回')
    if (state === 'failed') return label('Unavailable', '暂不可用')
    if (state === 'cancelled') return label('Cancelled', '已取消')
    return label('Not checked', '待检测')
  }
  return {
    label,
    currentLang,
    stateText,
    formatTime: formatDateTime,
    accessText: (status?: AccessStatus | null): string =>
      status ? pair(accessLabels[status]) : label('Not checked', '待检测'),
    reasonText: (reason?: AccessReason | null): string => (reason ? pair(reasons[reason]) : ''),
    issueText: (issue?: NetworkIssue | null): string => (issue ? pair(issues[issue]) : ''),
    typeText: (type: NetworkType | null | undefined): string => (type ? pair(types[type]) : '—'),
    riskText: (value: number | null | undefined): string =>
      value == null
        ? label('No score available', '暂无评分')
        : value <= 25
          ? label('Low', '低')
          : value <= 50
            ? label('Moderate', '中等')
            : value <= 75
              ? label('High', '高')
              : label('Very high', '很高'),
    routeText: (route?: string): string =>
      route === 'direct'
        ? label('Direct at app level', '应用层直连')
        : route === 'proxy'
          ? label('System proxy rule matched', '匹配系统代理规则')
          : label('Route unconfirmed', '路径待确认'),
    countryText: (country: string): string => {
      try {
        return (
          new Intl.DisplayNames([currentLang.value === 'zh' ? 'zh-CN' : 'en'], {
            type: 'region',
          }).of(country) ?? country
        )
      } catch {
        return country
      }
    },
  }
}
