import type { TokenPlanProviderId } from '../../../shared/token-plan'

export interface TokenPlanProviderMeta {
  id: TokenPlanProviderId
  nameEn: string
  nameZh: string
  mark: string
  brandColor: string
  docsUrl: string
}

export const TOKEN_PLAN_PROVIDERS: TokenPlanProviderMeta[] = [
  {
    id: 'minimax',
    nameEn: 'MiniMax',
    nameZh: 'MiniMax',
    mark: 'M',
    brandColor: '#ea580c',
    docsUrl: 'https://platform.minimaxi.com/docs/token-plan/faq',
  },
  {
    id: 'zhipu',
    nameEn: 'Zhipu / Z.ai',
    nameZh: '智谱 / Z.ai',
    mark: '智',
    brandColor: '#0891b2',
    docsUrl: 'https://docs.bigmodel.cn/cn/coding-plan/overview',
  },
  {
    id: 'openai',
    nameEn: 'OpenAI',
    nameZh: 'OpenAI',
    mark: 'O',
    brandColor: '#059669',
    docsUrl: 'https://developers.openai.com/codex/',
  },
  {
    id: 'anthropic',
    nameEn: 'Anthropic',
    nameZh: 'Anthropic',
    mark: 'A',
    brandColor: '#b86d48',
    docsUrl: 'https://code.claude.com/docs/en/costs',
  },
  {
    id: 'kimi',
    nameEn: 'Kimi',
    nameZh: 'Kimi',
    mark: 'K',
    brandColor: '#5046d8',
    docsUrl: 'https://www.kimi.com/code',
  },
  {
    id: 'google',
    nameEn: 'Google',
    nameZh: 'Google',
    mark: 'G',
    brandColor: '#2563eb',
    docsUrl: 'https://geminicli.com/docs/quota-and-pricing/',
  },
  {
    id: 'xai',
    nameEn: 'xAI',
    nameZh: 'xAI',
    mark: 'X',
    brandColor: '#64748b',
    docsUrl: 'https://grok.com/',
  },
]

export const TOKEN_PLAN_PROVIDER_BY_ID = Object.fromEntries(
  TOKEN_PLAN_PROVIDERS.map((provider) => [provider.id, provider]),
) as Record<TokenPlanProviderId, TokenPlanProviderMeta>
