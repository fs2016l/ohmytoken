import type { AiRegionObservation } from '../../shared/network-check'
import {
  CLAUDE_REGIONS,
  GEMINI_API_REGIONS,
  GEMINI_WEB_REGIONS,
  OPENAI_REGIONS,
  REGION_ALPHA3,
} from './ai-region-data'

const reviewedAt = '2026-09-14'
const policies: Record<string, { countries: Set<string>; url: string }> = {
  'chatgpt-web': {
    countries: new Set(OPENAI_REGIONS),
    url: 'https://help.openai.com/en/articles/7947663-chatgpt-supported-countries',
  },
  'openai-api': {
    countries: new Set(OPENAI_REGIONS),
    url: 'https://developers.openai.com/api/docs/supported-countries',
  },
  'claude-web': {
    countries: new Set(CLAUDE_REGIONS),
    url: 'https://www.anthropic.com/supported-countries',
  },
  'anthropic-api': {
    countries: new Set(CLAUDE_REGIONS),
    url: 'https://www.anthropic.com/supported-countries',
  },
  'gemini-web': {
    countries: new Set(GEMINI_WEB_REGIONS),
    url: 'https://support.google.com/gemini/answer/13575153?hl=en-GB',
  },
  'gemini-studio': {
    countries: new Set(GEMINI_API_REGIONS),
    url: 'https://ai.google.dev/gemini-api/docs/available-regions',
  },
  'gemini-api': {
    countries: new Set(GEMINI_API_REGIONS),
    url: 'https://ai.google.dev/gemini-api/docs/available-regions',
  },
}
const knownRegions = new Set([...REGION_ALPHA3.values(), 'XK'])

export function regionCode(value: string): string | null {
  const code = value.toUpperCase()
  if (knownRegions.has(code)) return code
  return REGION_ALPHA3.get(code) ?? null
}

export function assessRegion(
  endpointId: string,
  value: string,
  source: AiRegionObservation['source'],
): AiRegionObservation | null {
  const country = regionCode(value)
  const policy = policies[endpointId]
  if (!country || !policy) return null
  const conditional =
    (endpointId === 'gemini-web' && country === 'CN') ||
    (country === 'UA' && !endpointId.startsWith('gemini-'))
  return {
    country,
    source,
    status: conditional
      ? 'conditional'
      : policy.countries.has(country)
        ? 'supported'
        : 'not_listed',
    policyUrl: policy.url,
    reviewedAt,
  }
}

// 只读取内联初始化数据，不执行脚本，也不从外部脚本地址或示例代码推断地区。
export function geminiPageRegion(body: string): string | null {
  const countries = new Set<string>()
  for (const script of body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(script[1])) continue
    const data = script[2].trim()
    if (!/^AF_initDataCallback\s*\(/.test(data)) continue
    for (const match of data.matchAll(/,\s*2\s*,\s*1\s*,\s*200\s*,\s*"([A-Z]{3})"/g)) {
      const country = regionCode(match[1])
      if (country) countries.add(country)
    }
  }
  return countries.size === 1 ? [...countries][0] : null
}
