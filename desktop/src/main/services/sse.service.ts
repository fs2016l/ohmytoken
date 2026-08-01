import { BrowserWindow } from 'electron'
import { agentIdentityHeaders } from '../../shared/agent-client'
import { IPC } from '../ipc/channels'
import { ensureAgentClientRegistered } from './client-registration.service'

const SSE_PATH = '/desktop/sse/connect'

const INITIAL_RECONNECT_DELAY = 1000
const MAX_RECONNECT_DELAY = 30000
const RECONNECT_MULTIPLIER = 2
const CONNECT_TIMEOUT = 15000
const READ_IDLE_TIMEOUT = 90000
const MAX_SSE_BUFFER_CHARS = 1024 * 1024
const MAX_SSE_EVENT_CHARS = 1024 * 1024

export interface PushMessage {
  type: 'news' | 'plan' | 'release' | 'broadcast' | 'notification' | 'custom' | 'connected'
  [key: string]: unknown
}

export type PushMessageHandler = (message: PushMessage) => void

export class SseService {
  private baseUrl: string
  private getToken: () => Promise<string | null>
  private abortController: AbortController | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private reconnectDelay = INITIAL_RECONNECT_DELAY
  private serverRetryMs = 0
  private started = false
  private connectionGeneration = 0
  private pushHandlers = new Set<PushMessageHandler>()
  private onTokenExpired: (() => Promise<void> | void) | null = null

  constructor(baseUrl: string, getToken: () => Promise<string | null>) {
    this.baseUrl = baseUrl
    this.getToken = getToken
  }

  start(onTokenExpired?: () => Promise<void> | void): void {
    const generation = ++this.connectionGeneration
    this.started = true
    this.onTokenExpired = onTokenExpired || null
    this.reconnectDelay = INITIAL_RECONNECT_DELAY
    this.serverRetryMs = 0
    this.cancelReconnect()
    this.clearIdleTimer()
    this.disconnect()
    void this.connect(generation)
  }

  stop(): void {
    this.started = false
    this.connectionGeneration += 1
    this.cancelReconnect()
    this.clearIdleTimer()
    this.disconnect()
  }

  onPushMessage(handler: PushMessageHandler): () => void {
    this.pushHandlers.add(handler)
    return () => this.pushHandlers.delete(handler)
  }

  private async connect(generation: number): Promise<void> {
    if (!this.started || generation !== this.connectionGeneration) return

    try {
      const token = await this.getToken()
      const identity = await ensureAgentClientRegistered(token)
      if (!this.started || generation !== this.connectionGeneration) return

      const url = new URL(this.baseUrl.replace(/\/+$/, '') + SSE_PATH)

      const controller = new AbortController()
      this.abortController = controller
      const { signal } = controller

      const timeoutId = setTimeout(() => {
        console.warn('[SSE] 连接超时，主动断开')
        controller.abort()
      }, CONNECT_TIMEOUT)

      console.info('[SSE] 正在连接: ' + url.toString())

      let response: Response
      try {
        response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            ...agentIdentityHeaders(identity),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            Accept: 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
          signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }

      if (!this.started || generation !== this.connectionGeneration) {
        if (response.body) {
          try {
            await response.body.cancel()
          } catch {
            void 0
          }
        }
        return
      }

      if (response.status === 401 && token) {
        console.warn('[SSE] 收到 401，尝试刷新登录凭据后重连')
        if (response.body) {
          try {
            await response.body.cancel()
          } catch {
            void 0
          }
        }
        await this.onTokenExpired?.()
        this.scheduleReconnect(generation)
        return
      }

      if (!response.ok || !response.body) {
        if (response.body) {
          try {
            await response.body.cancel()
          } catch {
            void 0
          }
        }
        throw new Error(`SSE 连接失败: HTTP ${response.status}`)
      }

      console.info('[SSE] 连接已建立，开始监听推送消息')

      this.reconnectDelay = this.serverRetryMs > 0 ? this.serverRetryMs : INITIAL_RECONNECT_DELAY

      await this.readStream(response.body as ReadableStream<Uint8Array>)
    } catch (err: unknown) {
      if (!this.started || generation !== this.connectionGeneration) {
        console.info('[SSE] 连接已主动断开')
        return
      }
      const error = err as Error
      const backendUnavailable =
        error.name === 'AbortError' ||
        (error instanceof TypeError && error.message === 'fetch failed')
      if (backendUnavailable) {
        console.info('[SSE] 后端暂不可用，等待自动重连')
      } else {
        console.warn('[SSE] 连接异常: ' + error.message)
      }
    }

    if (this.started && generation === this.connectionGeneration) {
      this.scheduleReconnect(generation)
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let currentEvent = 'message' // 默认事件名
    let currentData = ''

    const resetIdleTimer = (): void => {
      this.clearIdleTimer()
      this.idleTimer = setTimeout(() => {
        console.warn(`[SSE] 读空闲超时（${READ_IDLE_TIMEOUT / 1000}秒无数据），主动断开`)
        try {
          reader.cancel()
        } catch {
          void 0
        }
        this.abortController?.abort()
      }, READ_IDLE_TIMEOUT)
    }

    resetIdleTimer()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          console.info('[SSE] 服务器关闭了连接')
          break
        }

        resetIdleTimer()

        buffer += decoder.decode(value, { stream: true })
        if (buffer.length > MAX_SSE_BUFFER_CHARS) {
          throw new Error('SSE 行缓冲超过安全上限')
        }

        let newlineIndex: number
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const rawLine = buffer.substring(0, newlineIndex)
          buffer = buffer.substring(newlineIndex + 1)

          const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine

          if (line === '') {
            if (currentData) {
              this.dispatchEvent(currentEvent, currentData)
            }
            currentEvent = 'message'
            currentData = ''
          } else if (line.startsWith(':')) {
            void 0
          } else if (line.startsWith('event:')) {
            let eventVal = line.substring(6)
            if (eventVal.startsWith(' ')) eventVal = eventVal.substring(1)
            currentEvent = eventVal
          } else if (line.startsWith('data:')) {
            let dataVal = line.substring(5)
            if (dataVal.startsWith(' ')) dataVal = dataVal.substring(1)
            currentData += (currentData ? '\n' : '') + dataVal
            if (currentData.length > MAX_SSE_EVENT_CHARS) {
              throw new Error('SSE 事件超过安全上限')
            }
          } else if (line.startsWith('retry:')) {
            let retryVal = line.substring(6)
            if (retryVal.startsWith(' ')) retryVal = retryVal.substring(1)
            const retryMs = parseInt(retryVal, 10)
            if (!isNaN(retryMs) && retryMs > 0) {
              this.serverRetryMs = Math.min(retryMs, MAX_RECONNECT_DELAY)
              console.info(`[SSE] 服务端指定重连间隔: ${this.serverRetryMs}ms`)
            }
          }
        }
      }
    } finally {
      this.clearIdleTimer()
      try {
        reader.releaseLock()
      } catch {
        void 0
      }
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private dispatchEvent(eventName: string, dataStr: string): void {
    if (eventName === 'connected') {
      console.info('[SSE] 收到 connected 事件: ' + dataStr)
    } else if (eventName === 'error') {
      console.warn('[SSE] 收到服务端 error 事件: ' + dataStr)
      return
    } else {
      console.info(`[SSE] 收到推送事件 [${eventName}]`)
    }

    let message: PushMessage
    try {
      message = JSON.parse(dataStr) as PushMessage
    } catch {
      console.warn('[SSE] 事件数据 JSON 解析失败: ' + dataStr)
      return
    }

    for (const handler of this.pushHandlers) {
      try {
        handler(message)
      } catch (err) {
        console.error('[SSE] 推送处理器执行异常: ' + err)
      }
    }

    this.notifyRenderer(message)
  }

  private notifyRenderer(message: PushMessage): void {
    try {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.SSE_PUSH_MESSAGE, message)
        }
      }
    } catch (err) {
      console.error('[SSE] 通知渲染进程失败: ' + err)
    }
  }

  private scheduleReconnect(generation: number): void {
    if (!this.started || generation !== this.connectionGeneration) return

    this.cancelReconnect()

    const delay = this.serverRetryMs > 0 ? this.serverRetryMs : this.reconnectDelay

    console.info(`[SSE] ${delay / 1000}秒后重连...`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.started || generation !== this.connectionGeneration) return
      this.disconnect()
      void this.connect(generation)
    }, delay)

    if (this.serverRetryMs === 0) {
      this.reconnectDelay = Math.min(
        this.reconnectDelay * RECONNECT_MULTIPLIER,
        MAX_RECONNECT_DELAY,
      )
    }
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private disconnect(): void {
    if (this.abortController) {
      try {
        this.abortController.abort()
      } catch {
        void 0
      }
      this.abortController = null
    }
  }
}
