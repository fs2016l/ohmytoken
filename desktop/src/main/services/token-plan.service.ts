import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import {
  TOKEN_PLAN_PROVIDER_IDS,
  TOKEN_PLAN_WINDOW_IDS,
  type TokenPlanCredentialInput,
  type TokenPlanCredentialStatus,
  type TokenPlanErrorCode,
  type TokenPlanExtraQuota,
  type TokenPlanProviderId,
  type TokenPlanUnavailableReason,
  type TokenPlanUsageSnapshot,
  type TokenPlanWindowId,
  type TokenPlanWindowUsage,
} from '../../shared/token-plan'

const CREDENTIAL_FILE_NAME = 'token-plan-credentials.enc'
const MAGIC_ENC = 'ENC1:'
const REQUEST_TIMEOUT_MS = 15_000
const MAX_API_KEY_LENGTH = 4096
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024

const ENDPOINTS = {
  minimax: 'https://www.minimaxi.com/v1/token_plan/remains',
  zhipu: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
} as const

interface StoredCredential {
  apiKey: string
  updatedAt: number
}

type CredentialStore = Partial<Record<TokenPlanProviderId, StoredCredential>>

interface MiniMaxRemain {
  model_name?: string
  start_time?: number
  end_time?: number
  current_interval_total_count?: number
  current_interval_usage_count?: number
  current_interval_remaining_percent?: number
  weekly_start_time?: number
  weekly_end_time?: number
  current_weekly_total_count?: number
  current_weekly_usage_count?: number
  current_weekly_remaining_percent?: number
  current_weekly_status?: number
}

interface MiniMaxResponse {
  model_remains?: MiniMaxRemain[]
  base_resp?: { status_code?: number; status_msg?: string }
}

interface ZhipuLimit {
  type?: string
  unit?: number
  number?: number
  usage?: number
  currentValue?: number
  remaining?: number
  percentage?: number
  nextResetTime?: number
  usageDetails?: Array<{ modelCode?: string; usage?: number }>
}

interface ZhipuResponse {
  code?: number
  success?: boolean
  data?: { level?: string; limits?: ZhipuLimit[] }
}

class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super(`Provider HTTP ${status}`)
  }
}

let cachedStore: CredentialStore | null = null

function getCredentialFile(): string {
  return join(app.getPath('userData'), CREDENTIAL_FILE_NAME)
}

function isProviderId(value: unknown): value is TokenPlanProviderId {
  return TOKEN_PLAN_PROVIDER_IDS.includes(value as TokenPlanProviderId)
}

function normalizeStoredValue(value: unknown): StoredCredential | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<StoredCredential>
  if (typeof candidate.updatedAt !== 'number' || !Number.isFinite(candidate.updatedAt)) return null
  if (typeof candidate.apiKey !== 'string' || !candidate.apiKey) return null
  return { apiKey: candidate.apiKey, updatedAt: candidate.updatedAt }
}

function parseStore(raw: string): CredentialStore {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object') return {}

  const store: CredentialStore = {}
  for (const providerId of TOKEN_PLAN_PROVIDER_IDS) {
    const value = normalizeStoredValue((parsed as Record<string, unknown>)[providerId])
    if (value) store[providerId] = value
  }
  return store
}

function readCredentialStore(): CredentialStore {
  if (cachedStore) return cachedStore

  const file = getCredentialFile()
  if (!existsSync(file)) {
    cachedStore = {}
    return cachedStore
  }

  try {
    const data = readFileSync(file)
    const head = data.subarray(0, 5).toString('utf-8')
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统安全存储不可用')
    }
    if (head !== MAGIC_ENC) {
      // 新项目禁止继续保留历史明文或无格式密钥文件。
      try {
        unlinkSync(file)
      } catch {
        void 0
      }
      throw new Error('凭据文件不是受支持的加密格式，已清理')
    }

    const json = safeStorage.decryptString(data.subarray(Buffer.byteLength(MAGIC_ENC)))
    cachedStore = parseStore(json)
  } catch (error) {
    console.warn(`[token-plan] 读取套餐密钥失败: ${(error as Error).message}`)
    cachedStore = {}
  }
  return cachedStore
}

function writeCredentialStore(store: CredentialStore): void {
  const file = getCredentialFile()
  const tempFile = `${file}.tmp`
  const json = JSON.stringify(store)
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全存储不可用，不能保存套餐密钥')
  }
  const payload = Buffer.concat([Buffer.from(MAGIC_ENC), safeStorage.encryptString(json)])

  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(tempFile, payload)
  try {
    renameSync(tempFile, file)
  } catch {
    writeFileSync(file, payload)
    try {
      unlinkSync(tempFile)
    } catch {
      void 0
    }
  }
  cachedStore = store
}

export function listTokenPlanCredentials(): TokenPlanCredentialStatus[] {
  const store = readCredentialStore()
  return TOKEN_PLAN_PROVIDER_IDS.map((providerId) => {
    const credential = store[providerId]
    return {
      providerId,
      configured: Boolean(credential),
      updatedAt: credential?.updatedAt ?? null,
    }
  })
}

function cleanCredentialField(
  value: unknown,
  label: string,
  minimumLength: number,
  maximumLength: number,
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${label} 格式错误`)
  const normalized = value.trim()
  if (!normalized) return undefined
  if (
    normalized.length < minimumLength ||
    normalized.length > maximumLength ||
    /[\r\n]/.test(normalized)
  ) {
    throw new Error(`${label} 格式错误`)
  }
  return normalized
}

export function saveTokenPlanCredential(
  input: TokenPlanCredentialInput,
): TokenPlanCredentialStatus {
  if (!isProviderId(input?.providerId)) throw new Error('不支持的套餐厂商')
  const store = { ...readCredentialStore() }
  const apiKey = cleanCredentialField(input.apiKey, 'API Key', 8, MAX_API_KEY_LENGTH)
  if (!apiKey) throw new Error('没有可保存的凭据')
  store[input.providerId] = { apiKey, updatedAt: Date.now() }
  writeCredentialStore(store)
  return listTokenPlanCredentials().find((item) => item.providerId === input.providerId)!
}

export function removeTokenPlanCredential(providerId: TokenPlanProviderId): boolean {
  if (!isProviderId(providerId)) return false
  const store = { ...readCredentialStore() }
  delete store[providerId]
  writeCredentialStore(store)
  return true
}

function clampPercent(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, value))
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toTimestamp(value: unknown): number | null {
  const number = finiteNumber(value)
  if (number === null || number <= 0) return null
  return number < 10_000_000_000 ? number * 1000 : number
}

function unavailableWindow(
  id: TokenPlanWindowId,
  unavailableReason: TokenPlanUnavailableReason,
): TokenPlanWindowUsage {
  return {
    id,
    available: false,
    usedPercent: null,
    remainingPercent: null,
    used: null,
    limit: null,
    remaining: null,
    unit: null,
    startsAt: null,
    resetsAt: null,
    unavailableReason,
  }
}

function availableWindow(
  id: TokenPlanWindowId,
  values: {
    usedPercent?: number | null
    remainingPercent?: number | null
    used?: number | null
    limit?: number | null
    remaining?: number | null
    unit?: TokenPlanWindowUsage['unit']
    startsAt?: number | null
    resetsAt?: number | null
  },
): TokenPlanWindowUsage {
  const remainingPercent = clampPercent(values.remainingPercent ?? undefined)
  const explicitUsedPercent = clampPercent(values.usedPercent ?? undefined)
  const usedPercent =
    explicitUsedPercent ?? (remainingPercent === null ? null : Math.max(0, 100 - remainingPercent))

  return {
    id,
    available: true,
    usedPercent,
    remainingPercent:
      remainingPercent ?? (usedPercent === null ? null : Math.max(0, 100 - usedPercent)),
    used: values.used ?? null,
    limit: values.limit ?? null,
    remaining: values.remaining ?? null,
    unit: values.unit ?? null,
    startsAt: values.startsAt ?? null,
    resetsAt: values.resetsAt ?? null,
    unavailableReason: null,
  }
}

function providerDefaultWindows(): TokenPlanWindowUsage[] {
  return TOKEN_PLAN_WINDOW_IDS.map((id) => unavailableWindow(id, 'not_returned_by_api'))
}

async function fetchJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...headers,
      },
      signal: controller.signal,
    })
    if (!response.ok) throw new ProviderHttpError(response.status)
    const declaredSize = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredSize) && declaredSize > MAX_PROVIDER_RESPONSE_BYTES) {
      throw new Error('provider-response-too-large')
    }
    if (!response.body) throw new Error('provider-empty-response')

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_PROVIDER_RESPONSE_BYTES) {
          await reader.cancel()
          throw new Error('provider-response-too-large')
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } finally {
    clearTimeout(timer)
  }
}

function countValues(
  total: unknown,
  used: unknown,
): {
  limit: number | null
  used: number | null
  remaining: number | null
} {
  const limit = finiteNumber(total)
  const usedValue = finiteNumber(used)
  if (limit === null || usedValue === null || limit <= 0) {
    return { limit: null, used: null, remaining: null }
  }
  return { limit, used: usedValue, remaining: Math.max(0, limit - usedValue) }
}

async function queryMiniMax(apiKey: string): Promise<TokenPlanUsageSnapshot> {
  const response = await fetchJson<MiniMaxResponse>(ENDPOINTS.minimax, {
    Authorization: `Bearer ${apiKey}`,
  })
  if (response.base_resp?.status_code !== 0 || !Array.isArray(response.model_remains)) {
    throw new Error('invalid-response')
  }

  const quota =
    response.model_remains.find((item) => item.model_name?.toLowerCase() === 'general') ??
    response.model_remains[0]
  if (!quota) throw new Error('invalid-response')

  const intervalCounts = countValues(
    quota.current_interval_total_count,
    quota.current_interval_usage_count,
  )
  const weeklyCounts = countValues(
    quota.current_weekly_total_count,
    quota.current_weekly_usage_count,
  )

  return {
    providerId: 'minimax',
    status: 'partial',
    keyVerified: true,
    queriedAt: Date.now(),
    planName: quota.model_name ? `Token Plan · ${quota.model_name}` : 'Token Plan',
    modelCount: null,
    models: [],
    windows: [
      availableWindow('5h', {
        remainingPercent: quota.current_interval_remaining_percent,
        ...intervalCounts,
        unit: intervalCounts.limit === null ? null : 'requests',
        startsAt: toTimestamp(quota.start_time),
        resetsAt: toTimestamp(quota.end_time),
      }),
      quota.current_weekly_status === 1
        ? availableWindow('7d', {
            remainingPercent: quota.current_weekly_remaining_percent,
            ...weeklyCounts,
            unit: weeklyCounts.limit === null ? null : 'requests',
            startsAt: toTimestamp(quota.weekly_start_time),
            resetsAt: toTimestamp(quota.weekly_end_time),
          })
        : unavailableWindow('7d', 'not_returned_by_api'),
    ],
    extraQuotas: [],
    errorCode: null,
  }
}

function findZhipuLimit(limits: ZhipuLimit[], unit: number, number: number): ZhipuLimit | null {
  return (
    limits.find(
      (item) => item.type === 'TOKENS_LIMIT' && item.unit === unit && item.number === number,
    ) ?? null
  )
}

function buildZhipuExtraQuotas(limits: ZhipuLimit[]): TokenPlanExtraQuota[] {
  return limits
    .filter((item) => item.type === 'TIME_LIMIT')
    .flatMap((item, index) => {
      const limit = finiteNumber(item.usage)
      const used = finiteNumber(item.currentValue)
      if (limit === null || used === null) return []
      return [
        {
          id: `zhipu-time-limit-${index}`,
          label: item.unit === 5 && item.number === 1 ? '每月 MCP 工具调用' : '工具调用额度',
          used,
          limit,
          remaining: finiteNumber(item.remaining) ?? Math.max(0, limit - used),
          unit: 'requests' as const,
          resetsAt: toTimestamp(item.nextResetTime),
          details: Array.isArray(item.usageDetails)
            ? item.usageDetails.flatMap((detail) => {
                const detailUsed = finiteNumber(detail.usage)
                return detail.modelCode && detailUsed !== null
                  ? [{ name: detail.modelCode, used: detailUsed }]
                  : []
              })
            : [],
        },
      ]
    })
}

async function queryZhipu(apiKey: string): Promise<TokenPlanUsageSnapshot> {
  const response = await fetchJson<ZhipuResponse>(ENDPOINTS.zhipu, {
    Authorization: `Bearer ${apiKey}`,
  })
  if (response.code !== 200 || response.success !== true || !Array.isArray(response.data?.limits)) {
    throw new Error('invalid-response')
  }

  const limits = response.data.limits
  const fiveHours = findZhipuLimit(limits, 3, 5)
  const sevenDays = findZhipuLimit(limits, 6, 1)

  return {
    providerId: 'zhipu',
    status: 'partial',
    keyVerified: true,
    queriedAt: Date.now(),
    planName: response.data.level ? `GLM Coding Plan · ${response.data.level}` : 'GLM Coding Plan',
    modelCount: null,
    models: [],
    windows: [
      fiveHours
        ? availableWindow('5h', {
            usedPercent: fiveHours.percentage,
            resetsAt: toTimestamp(fiveHours.nextResetTime),
          })
        : unavailableWindow('5h', 'not_returned_by_api'),
      sevenDays
        ? availableWindow('7d', {
            usedPercent: sevenDays.percentage,
            resetsAt: toTimestamp(sevenDays.nextResetTime),
          })
        : unavailableWindow('7d', 'not_returned_by_api'),
    ],
    extraQuotas: buildZhipuExtraQuotas(limits),
    errorCode: null,
  }
}

function errorCodeFrom(error: unknown): TokenPlanErrorCode {
  if (error instanceof ProviderHttpError) {
    if (error.status === 401 || error.status === 403) return 'invalid_credential'
    if (error.status === 429) return 'rate_limited'
    return 'provider_unavailable'
  }
  if (error instanceof DOMException && error.name === 'AbortError') return 'network_error'
  if (error instanceof Error) {
    switch (error.message) {
      case 'invalid-credential':
        return 'invalid_credential'
      case 'provider-unavailable':
        return 'provider_unavailable'
      case 'invalid-response':
        return 'invalid_response'
      case 'network-error':
      case 'login-timeout':
      case 'login-cancelled':
        return 'network_error'
    }
  }
  if (
    error instanceof SyntaxError ||
    (error instanceof Error && error.message === 'invalid-response')
  ) {
    return 'invalid_response'
  }
  return 'network_error'
}

function errorSnapshot(
  providerId: TokenPlanProviderId,
  errorCode: TokenPlanErrorCode,
): TokenPlanUsageSnapshot {
  return {
    providerId,
    status: 'error',
    keyVerified: false,
    queriedAt: Date.now(),
    planName: null,
    modelCount: null,
    models: [],
    windows: providerDefaultWindows(),
    extraQuotas: [],
    errorCode,
  }
}

export async function queryTokenPlanUsage(
  providerId: TokenPlanProviderId,
): Promise<TokenPlanUsageSnapshot> {
  if (!isProviderId(providerId)) return errorSnapshot('minimax', 'invalid_response')
  const credential = readCredentialStore()[providerId]
  if (!credential) return errorSnapshot(providerId, 'not_configured')

  try {
    switch (providerId) {
      case 'minimax':
        return await queryMiniMax(credential.apiKey)
      case 'zhipu':
        return await queryZhipu(credential.apiKey)
    }
  } catch (error) {
    return errorSnapshot(providerId, errorCodeFrom(error))
  }
}

export async function queryAllTokenPlanUsage(): Promise<TokenPlanUsageSnapshot[]> {
  const store = readCredentialStore()
  const configuredProviders = TOKEN_PLAN_PROVIDER_IDS.filter((providerId) => store[providerId])
  return await Promise.all(configuredProviders.map((providerId) => queryTokenPlanUsage(providerId)))
}
