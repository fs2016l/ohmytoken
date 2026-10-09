/**
 * HTTP API 层 — 远程后端走 axios（ohmytokencom）
 *
 * renderer 不保存业务域名；启动后只从主进程取得经过校验的唯一 API Base。
 */
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import {
  AGENT_DEVICE_CREDENTIAL_HEADER,
  AGENT_DEVICE_ID_HEADER,
  AGENT_USER_ID_HEADER,
  DEVICE_CREDENTIAL_INVALID_CODE,
} from '@shared/agent-client'

export const ohmytokenApi = axios.create({
  baseURL: undefined,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
})

async function applyIdentityHeaders(config: InternalAxiosRequestConfig): Promise<void> {
  await baseURLReady()
  if (!ohmytokenApi.defaults.baseURL) throw new Error('com API Base 尚未就绪')
  const result = await window.api.getAgentRequestIdentity()
  if (result.status === 'unavailable') throw new Error(result.message)
  const identity = result.identity
  config.headers.set(AGENT_DEVICE_ID_HEADER, identity.deviceId)
  if (identity.userId !== null) {
    config.headers.set(AGENT_USER_ID_HEADER, String(identity.userId))
  } else {
    config.headers.delete(AGENT_USER_ID_HEADER)
  }
  if (identity.deviceCredential) {
    config.headers.set(AGENT_DEVICE_CREDENTIAL_HEADER, identity.deviceCredential)
  } else {
    config.headers.delete(AGENT_DEVICE_CREDENTIAL_HEADER)
  }
}

ohmytokenApi.interceptors.request.use(async (config) => {
  await applyIdentityHeaders(config)
  return config
})

/** 并发 401 只触发一次重新登记；全部等待同一个换新完成后各自重试。 */
let credentialRefresh: Promise<void> | null = null

function refreshCredentialOnce(): Promise<void> {
  if (!credentialRefresh) {
    credentialRefresh = window.api
      .refreshDeviceCredential()
      .then((result) => {
        if (result.status === 'unavailable') throw new Error(result.message)
      })
      .finally(() => {
        credentialRefresh = null
      })
  }
  return credentialRefresh
}

ohmytokenApi.interceptors.response.use(undefined, async (error: AxiosError) => {
  const config = error.config as
    (InternalAxiosRequestConfig & { credentialRetried?: boolean }) | undefined
  const status = error.response?.status
  const code: unknown = (error.response?.data as { code?: unknown } | undefined)?.code
  if (
    !config ||
    config.credentialRetried ||
    status !== 401 ||
    code !== DEVICE_CREDENTIAL_INVALID_CODE
  ) {
    throw error
  }
  config.credentialRetried = true
  await refreshCredentialOnce()
  await applyIdentityHeaders(config)
  return ohmytokenApi.request(config)
})

/**
 * L12 修复：baseURL 就绪 Promise。
 *
 * 所有请求都等待主进程返回 API Base，避免生产包在初始化失败时误请求 localhost。
 *
 * 调用方在发早期请求前 `await baseURLReady()` 可确保 baseURL 已被 IPC 覆盖。
 * IPC 通常瞬时完成，对其他请求无需等待。
 */
let baseURLReadyPromise: Promise<void> = Promise.resolve()
let baseURLReadyResolve: (() => void) | null = null

// 运行时通过 IPC 获取 ohmytokencom 后端地址（启动脚本可覆盖）
if (typeof window !== 'undefined' && window.api?.getOhmytokenBase) {
  // 创建一个待 resolve 的 Promise；失败后请求会明确报“API Base 尚未就绪”。
  baseURLReadyPromise = new Promise<void>((resolve) => {
    baseURLReadyResolve = resolve
  })
  window.api
    .getOhmytokenBase()
    .then((base: string) => {
      if (base) ohmytokenApi.defaults.baseURL = base
    })
    .catch((error) => {
      console.error('[http] 读取 com API Base 失败:', error)
    })
    .finally(() => {
      baseURLReadyResolve?.()
      baseURLReadyResolve = null
    })
}

/**
 * 等待 baseURL 就绪（IPC getOhmytokenBase 完成）。
 * 早期请求（应用启动时立即发出的请求）应 await 此函数，确保 baseURL 已被覆盖。
 */
export function baseURLReady(): Promise<void> {
  return baseURLReadyPromise
}

export default ohmytokenApi

export async function cloudApiUrl(
  key: import('@shared/runtime-config').DesktopApiKey,
  parameters?: import('@shared/runtime-config').DesktopApiParameters,
): Promise<string> {
  await baseURLReady()
  return window.api.resolveApiUrl(key, parameters)
}
