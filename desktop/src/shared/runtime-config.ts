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
}
