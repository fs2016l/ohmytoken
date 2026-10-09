/** com 后端公开下发给 Agent 的运行地址；不得包含任何密钥、Token 或 COS 源站凭据。 */
export interface DesktopRuntimeConfig {
  configVersion: number
  cacheTtlSeconds: number
  websiteUrl: string
  desktopLoginUrl: string
  accountPageUrl: string
  supportUrl: string
  privacyPolicyUrl: string
  updaterFeedUrl: string
  apiPaths: Record<DesktopApiKey, string>
}

export const DESKTOP_API_PARAMETERS = {
  discoveryConfig: [],
  discoveryUi: ['pageKey'],
  plans: [],
  apiModels: [],
  planTier: ['id'],
  apiModel: ['id'],
  agents: [],
  agent: ['id'],
  articles: [],
  article: ['id'],
  exchangeRates: [],
  clientRegister: [],
  updateCheck: [],
  oauthToken: [],
  oauthRefresh: [],
  oauthRevoke: [],
  oauthSession: [],
  userInfo: [],
  feedbackSubmit: [],
  messageSync: [],
  heartbeat: [],
  messageEvent: ['messageId'],
  diagnosticSubmit: [],
  favorites: [],
  favorite: ['targetType', 'targetId'],
} as const

export type DesktopApiKey = keyof typeof DESKTOP_API_PARAMETERS
export type DesktopApiParameters = Record<string, string | number>
