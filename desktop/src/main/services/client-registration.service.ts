import { app } from 'electron'
import { release as osRelease } from 'os'
import type { AgentRequestIdentity, AgentRequestIdentityResult } from '../../shared/agent-client'
import { parseDeviceCredential } from '../../shared/agent-client'
import { remoteUnavailableMessage } from './remote-availability'
import {
  AGENT_DEVICE_ID_HEADER,
  AGENT_USER_ID_HEADER,
  agentIdentityHeaders,
} from '../../shared/agent-client'
import {
  clearDeviceCredential,
  currentDeviceCredential,
  saveDeviceCredential,
  shouldRotateDeviceCredential,
} from './device-credential.service'
import { getDeviceId } from './device-id.service'
import { getOhmytokenApiBase } from './server-config.service'
import { resolveDesktopApiUrl } from './runtime-config.service'

const API_BASE = getOhmytokenApiBase()

const CLIENT_TYPE = 'ohmyagent-desktop'
const REQUEST_TIMEOUT_MS = 10_000

interface ClientRegistration {
  fingerprint: string
  deviceId: string
}

interface RegisterResponse {
  code?: number
  message?: string
  data?: unknown
}

interface RegistrationOptions {
  /** 跳过指纹/凭证检查，强制重新登记并轮换凭证。 */
  force?: boolean
  /** 禁止临期后台换新（防止强制流程里递归触发）。 */
  allowBackgroundRotation?: boolean
}

let registration: ClientRegistration | null = null
let registrationPromise: Promise<ClientRegistration> | null = null

function versionToCode(version: string): number {
  const matched = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)
  if (!matched) {
    throw new Error('Agent 版本必须是严格的 x.y.z：' + version)
  }
  const major = Number(matched[1])
  const minor = Number(matched[2])
  const patch = Number(matched[3])
  if (major >= 10_000 || minor >= 100 || patch >= 100) {
    throw new Error('Agent 版本超出 versionCode 范围：' + version)
  }
  return major * 100_000 + minor * 1_000 + patch * 10
}

function tokenUserId(token: string | null | undefined): number | null {
  if (!token) return null
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      userId?: number | string
    }
    const userId = Number(parsed.userId)
    return Number.isSafeInteger(userId) && userId > 0 ? userId : null
  } catch {
    return null
  }
}

/**
 * 上报操作系统架构，而不是 Electron 可执行文件自身的编译架构。
 * Windows 的 process.platform 固定叫 win32，与 32/64 位无关；WOW64 场景通过
 * PROCESSOR_ARCHITEW6432 识别宿主系统架构。
 */
function operatingSystemArch(): 'x64' | 'arm64' {
  if (process.platform === 'win32') {
    const windowsArch = (
      process.env.PROCESSOR_ARCHITEW6432 ||
      process.env.PROCESSOR_ARCHITECTURE ||
      process.arch
    ).toLowerCase()
    if (windowsArch.includes('arm64')) return 'arm64'
    return 'x64'
  }
  return process.arch === 'arm64' ? 'arm64' : 'x64'
}

async function metadata(): Promise<{
  body: Record<string, string | number>
  fingerprint: string
}> {
  const deviceId = await getDeviceId()
  const agentVersion = app.getVersion()
  const body = {
    deviceId,
    clientType: CLIENT_TYPE,
    agentVersion,
    versionCode: versionToCode(agentVersion),
    platform: process.platform,
    arch: operatingSystemArch(),
    osVersion: osRelease(),
    locale: app.getLocale(),
  }
  return { body, fingerprint: JSON.stringify(body) }
}

async function sendRegistration(
  body: Record<string, string | number>,
  token: string | null,
): Promise<Response> {
  const userId = tokenUserId(token)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(await resolveDesktopApiUrl('clientRegister'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'OhMyTokenAgent/' + String(body.agentVersion) + ' Electron/' + process.versions.electron,
        [AGENT_DEVICE_ID_HEADER]: String(body.deviceId),
        ...(userId !== null ? { [AGENT_USER_ID_HEADER]: String(userId) } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function registerClient(
  body: Record<string, string | number>,
  fingerprint: string,
  token: string | null,
): Promise<ClientRegistration> {
  let response = await sendRegistration(body, token)
  if (response.status === 401 && token) response = await sendRegistration(body, null)

  const text = await response.text()
  let result: RegisterResponse = {}
  try {
    result = JSON.parse(text) as RegisterResponse
  } catch {
    void 0
  }
  if (!response.ok || result.code !== 200) {
    throw new Error(result.message || 'Agent 客户端登记失败 (HTTP ' + response.status + ')')
  }
  // 登记成功即保存（或轮换）内容接口设备凭证；旧服务端不返回凭证时清掉旧值避免携带过期凭证。
  const issued = parseDeviceCredential(result.data)
  if (issued) {
    saveDeviceCredential(issued)
  } else {
    clearDeviceCredential()
  }
  return {
    fingerprint,
    deviceId: String(body.deviceId),
  }
}

export async function ensureAgentClientRegistered(
  token: string | null = null,
  options: RegistrationOptions = {},
): Promise<AgentRequestIdentity> {
  const current = await metadata()
  const needsRegistration =
    options.force === true || !registration || registration.fingerprint !== current.fingerprint
  if (needsRegistration) {
    if (!registrationPromise) {
      registrationPromise = registerClient(current.body, current.fingerprint, token)
        .then((registered) => {
          registration = registered
          return registered
        })
        .finally(() => {
          registrationPromise = null
        })
    }
    await registrationPromise
  }

  if (!registration) throw new Error('Agent 客户端尚未登记')
  // 懒续期：凭证临期时后台静默重登记换新，不阻塞当前请求；失败也不影响本次凭证（未过期时）。
  if (
    !needsRegistration &&
    options.allowBackgroundRotation !== false &&
    shouldRotateDeviceCredential()
  ) {
    void ensureAgentClientRegistered(token, { force: true, allowBackgroundRotation: false }).catch(
      (error) => {
        console.warn('[client-registration] 设备凭证后台换新失败，等待下次请求重试:', error)
      },
    )
  }
  return {
    deviceId: registration.deviceId,
    userId: tokenUserId(token),
    deviceCredential: currentDeviceCredential(),
  }
}

/**
 * 凭证被服务端拒绝（401 + code=7016）后的恢复入口：清掉本地凭证并强制重新登记。
 * 重新登记成功返回新的身份；失败按远端不可用处理，由调用方决定本次请求的结果。
 */
export async function resolveRefreshedAgentRequestIdentity(
  readToken: () => Promise<string | null>,
): Promise<AgentRequestIdentityResult> {
  try {
    clearDeviceCredential()
    const identity = await ensureAgentClientRegistered(await readToken(), {
      force: true,
      allowBackgroundRotation: false,
    })
    return { status: 'ready', identity }
  } catch (error) {
    return { status: 'unavailable', message: remoteUnavailableMessage(API_BASE, error) }
  }
}

export async function getAgentIdentityHeaders(
  token: string | null = null,
): Promise<Record<string, string>> {
  return agentIdentityHeaders(await ensureAgentClientRegistered(token))
}

export async function resolveAgentRequestIdentity(
  readToken: () => Promise<string | null>,
): Promise<AgentRequestIdentityResult> {
  try {
    const identity = await ensureAgentClientRegistered(await readToken())
    return { status: 'ready', identity }
  } catch (error) {
    return { status: 'unavailable', message: remoteUnavailableMessage(API_BASE, error) }
  }
}
