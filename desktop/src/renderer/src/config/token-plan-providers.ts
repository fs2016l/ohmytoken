import type { TokenPlanProviderId, TokenPlanWindowId } from '../../../shared/token-plan'

export type TokenPlanCategory = 'coding' | 'token'

export interface TokenPlanProviderMeta {
  id: TokenPlanProviderId
  nameEn: string
  nameZh: string
  shortName: string
  mark: string
  category: TokenPlanCategory
  brandColor: string
  gradient: string
  docsUrl: string
  keyHint: string
  windowIds: readonly TokenPlanWindowId[]
}

export const TOKEN_PLAN_PROVIDERS: TokenPlanProviderMeta[] = [
  {
    id: 'minimax',
    nameEn: 'MiniMax Token Plan',
    nameZh: 'MiniMax Token Plan',
    shortName: 'MiniMax',
    mark: 'M',
    category: 'token',
    brandColor: '#f97316',
    gradient: 'linear-gradient(135deg, #fb923c, #ea580c)',
    docsUrl: 'https://platform.minimaxi.com/docs/token-plan/faq',
    keyHint: 'sk-…',
    windowIds: ['5h', '7d'],
  },
  {
    id: 'zhipu',
    nameEn: 'Zhipu GLM Coding Plan',
    nameZh: '智谱 GLM Coding Plan',
    shortName: 'GLM',
    mark: '智',
    category: 'coding',
    brandColor: '#0891b2',
    gradient: 'linear-gradient(135deg, #22d3ee, #0e7490)',
    docsUrl: 'https://docs.bigmodel.cn/cn/coding-plan/overview',
    keyHint: 'API Key',
    windowIds: ['5h', '7d'],
  },
]

export const TOKEN_PLAN_PROVIDER_BY_ID = Object.fromEntries(
  TOKEN_PLAN_PROVIDERS.map((provider) => [provider.id, provider]),
) as Record<TokenPlanProviderId, TokenPlanProviderMeta>
