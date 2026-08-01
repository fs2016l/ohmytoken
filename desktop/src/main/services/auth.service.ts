import { BrowserWindow, app, powerMonitor, safeStorage, shell } from 'electron'
import { randomBytes, createHash } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '../ipc/channels'
import { agentIdentityHeaders } from '../../shared/agent-client'
import { ensureAgentClientRegistered } from './client-registration.service'
import { getDesktopRuntimeConfig } from './runtime-config.service'
import { getOhmytokenApiBase } from './server-config.service'

const OHMYTOKEN_API_BASE = getOhmytokenApiBase()

const CLIENT_ID = 'ohmytoken-desktop'

const REQUEST_TIMEOUT_MS = 10_000

interface ActiveLogin {
  server: Server
  timeoutHandle: NodeJS.Timeout | null
}

let activeLogin: ActiveLogin | null = null
let activeLoginStart: Promise<boolean> | null = null

let onLoginSuccessCallback: (() => void) | null = null

export function setOnLoginSuccessCallback(callback: () => void): void {
  onLoginSuccessCallback = callback
}

function closeLogin(server?: Server): void {
  const current = activeLogin
  if (current && (!server || current.server === server)) {
    if (current.timeoutHandle) clearTimeout(current.timeoutHandle)
    activeLogin = null
  }
  const target = server ?? current?.server
  if (!target) return
  try {
    target.close()
    target.closeIdleConnections()
  } catch {
    void 0
  }
}

export interface AuthSession {
  version: 1
  sessionId: string
  accessToken: string
  accessTokenExpiresAt: number
  refreshToken: string
  refreshTokenExpiresAt: number
}

interface DesktopTokenData {
  accessToken?: unknown
  accessTokenExpiresIn?: unknown
  refreshToken?: unknown
  refreshTokenExpiresIn?: unknown
  sessionId?: unknown
}

interface TokenResponseEnvelope {
  code?: number
  message?: string
  data?: DesktopTokenData
}

class AuthRefreshRejectedError extends Error {}
class AuthSessionChangedError extends Error {}

const AUTH_FILE_MAGIC = 'AUTH1:'
const AUTH_SESSION_VERSION = 1
const MAX_REFRESH_AHEAD_MS = 10 * 60 * 1000
const MIN_REFRESH_AHEAD_MS = 5_000
const REFRESH_RETRY_MS = 5_000
const INVALID_REFRESH_CODES = new Set([7008, 7009, 7013, 7014])

let memorySession: AuthSession | null = null
let sessionRevision = 0
let refreshPromise: Promise<AuthSession> | null = null
let refreshTimer: NodeJS.Timeout | null = null
let authSessionManagerInitialized = false
let onTokenRefreshedCallback: (() => void) | null = null
let onSessionInvalidatedCallback: (() => void) | null = null

export function setOnTokenRefreshedCallback(callback: () => void): void {
  onTokenRefreshedCallback = callback
}

export function setOnSessionInvalidatedCallback(callback: () => void): void {
  onSessionInvalidatedCallback = callback
}

function getAuthFile(): string {
  return join(app.getPath('userData'), 'auth-session.enc')
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AuthSession>
  return (
    candidate.version === AUTH_SESSION_VERSION &&
    typeof candidate.sessionId === 'string' &&
    candidate.sessionId.length > 0 &&
    typeof candidate.accessToken === 'string' &&
    candidate.accessToken.length > 0 &&
    typeof candidate.accessTokenExpiresAt === 'number' &&
    Number.isFinite(candidate.accessTokenExpiresAt) &&
    typeof candidate.refreshToken === 'string' &&
    candidate.refreshToken.length > 0 &&
    typeof candidate.refreshTokenExpiresAt === 'number' &&
    Number.isFinite(candidate.refreshTokenExpiresAt)
  )
}

function scheduleAuthRefresh(session: AuthSession): void {
  if (!authSessionManagerInitialized) return
  if (refreshTimer) clearTimeout(refreshTimer)
  const remainingMs = session.accessTokenExpiresAt - Date.now()
  const refreshAheadMs = Math.min(
    MAX_REFRESH_AHEAD_MS,
    Math.max(MIN_REFRESH_AHEAD_MS, remainingMs * 0.2),
  )
  const delayMs = Math.max(1_000, remainingMs - refreshAheadMs)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void refreshForScheduler()
  }, delayMs)
}

function scheduleRefreshRetry(): void {
  if (!authSessionManagerInitialized || !loadAuthSession()) return
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void refreshForScheduler()
  }, REFRESH_RETRY_MS)
}

export function saveAuthSession(session: AuthSession): void {
  memorySession = { ...session }
  sessionRevision += 1
  scheduleAuthRefresh(session)

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[auth] safeStorage 不可用，会话仅保存在内存中，应用重启后需要重新登录')
    return
  }

  const file = getAuthFile()
  const tempFile = file + '.tmp'
  try {
    const encrypted = safeStorage.encryptString(JSON.stringify(session))
    writeFileSync(tempFile, Buffer.concat([Buffer.from(AUTH_FILE_MAGIC, 'utf8'), encrypted]))
    renameSync(tempFile, file)
  } catch (error) {
    console.error('[auth] 加密保存会话失败，会话仅在本次运行有效:', error)
    try {
      if (existsSync(tempFile)) unlinkSync(tempFile)
    } catch {
      void 0
    }
  }
}

export function loadAuthSession(): AuthSession | null {
  if (memorySession) return { ...memorySession }
  const file = getAuthFile()
  if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return null

  try {
    const data = readFileSync(file)
    const prefixLength = Buffer.byteLength(AUTH_FILE_MAGIC)
    if (data.subarray(0, prefixLength).toString('utf8') !== AUTH_FILE_MAGIC) {
      throw new Error('会话文件格式不正确')
    }
    const decrypted = safeStorage.decryptString(data.subarray(prefixLength))
    const parsed = JSON.parse(decrypted) as unknown
    if (!isAuthSession(parsed)) throw new Error('会话字段不完整')
    memorySession = parsed
    return { ...parsed }
  } catch (error) {
    console.warn('[auth] 读取加密会话失败:', error)
    clearAuthSession()
    return null
  }
}

export function hasAuthSession(): boolean {
  return loadAuthSession() !== null
}

export function clearAuthSession(): boolean {
  memorySession = null
  sessionRevision += 1
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }

  const files = [getAuthFile(), getAuthFile() + '.tmp']
  let success = true
  for (const file of files) {
    if (!existsSync(file)) continue
    try {
      unlinkSync(file)
    } catch (error) {
      success = false
      console.error('[auth] 删除会话文件失败:', error)
    }
  }
  return success
}

function sessionFromTokenData(
  data: DesktopTokenData | undefined,
  validityStartedAt: number,
): AuthSession {
  if (
    typeof data?.accessToken !== 'string' ||
    typeof data.accessTokenExpiresIn !== 'number' ||
    !Number.isFinite(data.accessTokenExpiresIn) ||
    data.accessTokenExpiresIn <= 0 ||
    typeof data.refreshToken !== 'string' ||
    typeof data.refreshTokenExpiresIn !== 'number' ||
    !Number.isFinite(data.refreshTokenExpiresIn) ||
    data.refreshTokenExpiresIn <= 0 ||
    typeof data.sessionId !== 'string' ||
    data.sessionId.length === 0
  ) {
    throw new Error('Token 响应缺少双 Token 会话字段')
  }
  return {
    version: AUTH_SESSION_VERSION,
    sessionId: data.sessionId,
    accessToken: data.accessToken,
    accessTokenExpiresAt: validityStartedAt + data.accessTokenExpiresIn * 1000,
    refreshToken: data.refreshToken,
    refreshTokenExpiresAt: validityStartedAt + data.refreshTokenExpiresIn * 1000,
  }
}

async function parseTokenResponse(
  response: Response,
  action: string,
  validityStartedAt: number,
): Promise<AuthSession> {
  const text = await response.text()
  let body: TokenResponseEnvelope = {}
  try {
    body = JSON.parse(text) as TokenResponseEnvelope
  } catch {
    throw new Error(action + '失败：服务器响应格式不正确')
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AuthRefreshRejectedError(body.message || action + '凭证无效')
    }
    throw new Error(action + '失败 (HTTP ' + response.status + ')')
  }
  if (body.code !== 200) {
    if (typeof body.code === 'number' && INVALID_REFRESH_CODES.has(body.code)) {
      throw new AuthRefreshRejectedError(body.message || action + '凭证无效')
    }
    throw new Error(body.message || action + '失败 (code=' + String(body.code) + ')')
  }
  return sessionFromTokenData(body.data, validityStartedAt)
}

async function requestTokenRefresh(current: AuthSession): Promise<AuthSession> {
  const identity = await ensureAgentClientRegistered(null)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const validityStartedAt = Date.now()
    const response = await fetch(OHMYTOKEN_API_BASE + '/desktop/oauth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...agentIdentityHeaders(identity),
      },
      body: JSON.stringify({
        clientId: CLIENT_ID,
        refreshToken: current.refreshToken,
      }),
      signal: controller.signal,
    })
    return await parseTokenResponse(response, 'Token 自动续期', validityStartedAt)
  } finally {
    clearTimeout(timeout)
  }
}

function invalidateAuthSession(): void {
  const hadSession = loadAuthSession() !== null
  clearAuthSession()
  if (hadSession) onSessionInvalidatedCallback?.()
}

async function rotateAuthSession(): Promise<AuthSession> {
  if (refreshPromise) return refreshPromise
  const current = loadAuthSession()
  if (!current) throw new AuthRefreshRejectedError('没有可续期的登录会话')
  const expectedRevision = sessionRevision

  refreshPromise = requestTokenRefresh(current)
    .then((next) => {
      if (expectedRevision !== sessionRevision) {
        throw new AuthSessionChangedError('登录会话已发生变化')
      }
      saveAuthSession(next)
      onTokenRefreshedCallback?.()
      return next
    })
    .catch((error: unknown) => {
      if (error instanceof AuthRefreshRejectedError && expectedRevision === sessionRevision) {
        invalidateAuthSession()
      }
      throw error
    })
    .finally(() => {
      refreshPromise = null
    })

  return refreshPromise
}

export async function getAccessToken(
  minimumValidityMs = MIN_REFRESH_AHEAD_MS,
): Promise<string | null> {
  const current = loadAuthSession()
  if (!current) return null
  if (current.accessTokenExpiresAt - Date.now() > minimumValidityMs) {
    return current.accessToken
  }

  try {
    return (await rotateAuthSession()).accessToken
  } catch (error) {
    if (error instanceof AuthRefreshRejectedError) return null
    if (error instanceof AuthSessionChangedError) return loadAuthSession()?.accessToken ?? null
    const latest = loadAuthSession()
    if (latest && latest.accessTokenExpiresAt > Date.now()) return latest.accessToken
    throw error
  }
}

export async function forceRefreshAccessToken(): Promise<string | null> {
  try {
    return (await rotateAuthSession()).accessToken
  } catch (error) {
    if (error instanceof AuthRefreshRejectedError) return null
    if (error instanceof AuthSessionChangedError) return loadAuthSession()?.accessToken ?? null
    throw error
  }
}

async function refreshForScheduler(): Promise<void> {
  try {
    await rotateAuthSession()
  } catch (error) {
    if (error instanceof AuthRefreshRejectedError || error instanceof AuthSessionChangedError)
      return
    console.warn('[auth] 自动续期暂时失败，稍后重试:', error)
    scheduleRefreshRetry()
  }
}

function handleSystemResume(): void {
  const session = loadAuthSession()
  if (!session) return
  if (session.accessTokenExpiresAt - Date.now() <= MIN_REFRESH_AHEAD_MS) {
    void refreshForScheduler()
  } else {
    scheduleAuthRefresh(session)
  }
}

export function initializeAuthSessionManager(): void {
  if (authSessionManagerInitialized) return
  authSessionManagerInitialized = true
  powerMonitor.on('resume', handleSystemResume)
  const session = loadAuthSession()
  if (session) scheduleAuthRefresh(session)
}

export function shutdownAuthSessionManager(): void {
  if (!authSessionManagerInitialized) return
  authSessionManagerInitialized = false
  powerMonitor.removeListener('resume', handleSystemResume)
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
}

async function revokeRemoteSession(session: AuthSession): Promise<void> {
  const identity = await ensureAgentClientRegistered(null)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    await fetch(OHMYTOKEN_API_BASE + '/desktop/oauth/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...agentIdentityHeaders(identity),
      },
      body: JSON.stringify({
        clientId: CLIENT_ID,
        refreshToken: session.refreshToken,
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

export async function revokeAndClearAuthSession(): Promise<boolean> {
  const session = loadAuthSession()
  const cleared = clearAuthSession()
  if (!session) return cleared

  try {
    await revokeRemoteSession(session)
  } catch (error) {
    console.warn('[auth] 服务端会话撤销失败，本地凭证已清除:', error)
  }
  return cleared
}

function generatePkceMaterial(): {
  codeVerifier: string
  codeChallenge: string
  state: string
} {
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  const state = randomBytes(32).toString('base64url')
  return { codeVerifier, codeChallenge, state }
}

function buildRedirectUri(server: Server): string {
  const addr = server.address()
  if (!addr || typeof addr === 'string') return ''
  return `http://127.0.0.1:${addr.port}/auth/callback`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<AuthSession> {
  const identity = await ensureAgentClientRegistered(null)
  const validityStartedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${OHMYTOKEN_API_BASE}/desktop/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...agentIdentityHeaders(identity),
      },
      body: JSON.stringify({
        grantType: 'authorization_code',
        clientId: CLIENT_ID,
        code,
        redirectUri,
        codeVerifier,
      }),
      signal: controller.signal,
    })
    return await parseTokenResponse(response, 'Token 交换', validityStartedAt)
  } finally {
    clearTimeout(timeout)
  }
}

async function createLoginSession(
  redirectUri: string,
  state: string,
  codeChallenge: string,
): Promise<{ sessionId: string; expiresAt: number }> {
  const identity = await ensureAgentClientRegistered(null)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${OHMYTOKEN_API_BASE}/desktop/oauth/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...agentIdentityHeaders(identity),
      },
      body: JSON.stringify({
        clientId: CLIENT_ID,
        redirectUri,
        state,
        codeChallenge,
        codeChallengeMethod: 'S256',
      }),
      signal: controller.signal,
    })
    const body = (await response.json()) as {
      code?: number
      message?: string
      data?: { sessionId?: string; active?: boolean; expiresAt?: number }
    }
    if (
      !response.ok ||
      body.code !== 200 ||
      !body.data?.active ||
      !body.data.sessionId ||
      typeof body.data.expiresAt !== 'number'
    ) {
      throw new Error(body.message || `创建登录地址失败 (HTTP ${response.status})`)
    }
    return { sessionId: body.data.sessionId, expiresAt: body.data.expiresAt }
  } finally {
    clearTimeout(timeout)
  }
}

async function handleLoopbackCallback(
  req: IncomingMessage,
  res: ServerResponse,
  server: Server,
  codeVerifier: string,
  expectedState: string,
  redirectUri: string,
  windowGetter: () => BrowserWindow | null,
): Promise<void> {
  if (!req.url?.startsWith('/auth/callback')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
    return
  }

  const url = new URL(req.url, 'http://127.0.0.1')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (!state || state !== expectedState) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
        '<h2>state 校验失败</h2><p>请通过应用内登录按钮重新发起登录。</p>' +
        '</body></html>',
    )
    return
  }

  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
        '<h2>登录已取消</h2><p>可以关闭此页面返回应用。</p>' +
        '</body></html>',
    )
    closeLogin(server)
    return
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('missing code')
    return
  }

  try {
    const session = await exchangeCodeForToken(code, codeVerifier, redirectUri)
    if (activeLogin?.server !== server) {
      void revokeRemoteSession(session).catch((revokeError) => {
        console.warn('[auth] 已取消登录的服务端会话撤销失败:', revokeError)
      })
      if (!res.writableEnded) {
        res.writeHead(409, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
            '<h2>登录已失效</h2><p>请使用应用刚刚打开的新登录页面。</p>' +
            '</body></html>',
        )
      }
      return
    }

    saveAuthSession(session)

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>登录成功</title></head><body>' +
        '<h2>登录成功</h2><p>可以关闭此页面返回应用。</p>' +
        "<script>try{window.history.replaceState(null,'','/auth/complete')}catch(e){}</script>" +
        '</body></html>',
    )

    closeLogin(server)

    const win = windowGetter()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.AUTH_LOGIN_SUCCESS)
    }

    if (onLoginSuccessCallback) {
      onLoginSuccessCallback()
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
        `<h2>登录失败</h2><p>${escapeHtml((err as Error).message)}</p>` +
        '</body></html>',
    )
    closeLogin(server)
    console.error('[auth] token 交换失败:', err)
  }
}

async function startPkceLoginInternal(windowGetter: () => BrowserWindow | null): Promise<boolean> {
  closeLogin()
  const { codeVerifier, codeChallenge, state } = generatePkceMaterial()
  let redirectUri = ''

  const server = createServer((req, res) => {
    if (!redirectUri) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('loopback server 未就绪')
      return
    }
    void handleLoopbackCallback(req, res, server, codeVerifier, state, redirectUri, windowGetter)
  })
  activeLogin = { server, timeoutHandle: null }

  let launchResolver: ((value: boolean) => void) | null = null
  let launchSettled = false
  const settleLaunch = (value: boolean): void => {
    if (launchSettled) return
    launchSettled = true
    launchResolver?.(value)
  }

  server.on('error', (err) => {
    console.error('[auth] loopback server 启动/运行失败:', err)
    closeLogin(server)
    settleLaunch(false)
  })

  return await new Promise<boolean>((resolve) => {
    launchResolver = resolve
    server.listen(0, '127.0.0.1', async () => {
      redirectUri = buildRedirectUri(server)
      if (!redirectUri) {
        console.error('[auth] 无法获取 loopback server 端口，放弃登录')
        closeLogin(server)
        settleLaunch(false)
        return
      }

      try {
        const session = await createLoginSession(redirectUri, state, codeChallenge)
        if (activeLogin?.server !== server) {
          settleLaunch(false)
          return
        }

        const remainingMs = Math.max(1_000, session.expiresAt - Date.now() + 1_000)
        activeLogin.timeoutHandle = setTimeout(() => {
          closeLogin(server)
        }, remainingMs)

        // 每次登录强制刷新公开配置，避免继续使用后台已停用的旧登录入口。
        const runtimeConfig = await getDesktopRuntimeConfig(true)
        const loginUrl = new URL(runtimeConfig.desktopLoginUrl)
        loginUrl.searchParams.set('session_id', session.sessionId)
        await shell.openExternal(loginUrl.toString())
        settleLaunch(true)
      } catch (e) {
        console.error('[auth] 启动登录流程失败:', e)
        closeLogin(server)
        settleLaunch(false)
      }
    })
  })
}

/**
 * 登录启动 single-flight：头像无需被禁用，但同一次网络启动尚未结束时的重复点击
 * 复用同一 Promise，避免无限累积授权请求和连续弹出大量系统浏览器窗口。
 */
export function startPkceLogin(windowGetter: () => BrowserWindow | null): Promise<boolean> {
  if (activeLoginStart) return activeLoginStart
  const request = startPkceLoginInternal(windowGetter).finally(() => {
    if (activeLoginStart === request) activeLoginStart = null
  })
  activeLoginStart = request
  return request
}
