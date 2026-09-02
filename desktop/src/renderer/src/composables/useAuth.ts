import type { DesktopUserInfo } from '@shared/desktop-api'
import { computed, onMounted, ref } from 'vue'
import { useAppSettings } from './useAppSettings'

const { settings: appSettings } = useAppSettings()
export type UserInfo = DesktopUserInfo

const currentUser = ref<UserInfo | null>(null)
const isHydrating = ref(true)
let firstCheckDone = false

const isLoggedIn = computed(() => currentUser.value !== null)

async function clearInvalidToken(): Promise<void> {
  try {
    const result = await window.api.authLogout()
    if (!result.ok) {
      console.warn('[useAuth] 清理失效登录凭据失败:', result.message)
    }
  } catch (e) {
    console.warn('[useAuth] 清理失效登录凭据失败:', e)
  }
}

async function checkStatus(): Promise<void> {
  try {
    const session = await window.api.authSession()
    switch (session.status) {
      case 'authenticated':
        currentUser.value = session.user
        return
      case 'anonymous':
        currentUser.value = null
        return
      case 'invalid':
        await clearInvalidToken()
        currentUser.value = null
        return
      case 'unavailable':
        console.warn('[useAuth] 暂时无法验证登录状态:', session.message ?? '服务暂时不可用')
    }
  } finally {
    if (!firstCheckDone) {
      firstCheckDone = true
      isHydrating.value = false
    }
  }
}

let ipcSubscribed = false

function handleLoginSuccess(): void {
  void checkStatus()
}

function handleLogoutEvent(): void {
  currentUser.value = null
}

function showPushNotification(title: string, body: string): void {
  if (!appSettings.systemNotificationsEnabled) return
  if (!('Notification' in window)) return
  if (Notification.permission === 'granted') {
    new Notification(title, { body })
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        new Notification(title, { body })
      }
    })
  }
}

function handleSsePushMessage(message: Record<string, unknown>): void {
  const type = message.type as string | undefined
  const isEn = localStorage.getItem('app-lang') === 'en'
  switch (type) {
    case 'news': {
      if (isEn) {
        const title = (message.titleEn as string) || (message.titleZh as string) || 'New Update'
        const summary = (message.summaryEn as string) || (message.summaryZh as string) || ''
        showPushNotification(title, summary)
      } else {
        const title = (message.titleZh as string) || (message.titleEn as string) || '新消息'
        const summary = (message.summaryZh as string) || ''
        showPushNotification(title, summary)
      }
      break
    }
    case 'plan': {
      const scope = message.scope as string
      if (scope === 'provider') {
        const nameZh = (message.providerNameZh as string) || ''
        const nameEn = (message.providerNameEn as string) || nameZh
        showPushNotification(
          isEn ? 'Plan Update' : '套餐更新',
          isEn ? `${nameEn} plans updated` : `${nameZh} 套餐已更新`,
        )
      } else {
        showPushNotification(
          isEn ? 'Plan Update' : '套餐更新',
          isEn ? 'All plan list updated' : '套餐列表已更新',
        )
      }
      break
    }
    case 'release':
      showPushNotification(
        isEn ? `Update v${message.version ?? ''}` : `版本更新 v${message.version ?? ''}`,
        (message.message as string) || (isEn ? 'New version available' : '有新版本可更新'),
      )
      break
    case 'custom': {
      if (message.operation !== 'published') break
      const title = isEn
        ? (message.titleEn as string) || (message.titleZh as string) || 'Message'
        : (message.titleZh as string) || (message.titleEn as string) || '消息通知'
      const body = isEn
        ? (message.contentEn as string) || (message.contentZh as string) || ''
        : (message.contentZh as string) || (message.contentEn as string) || ''
      showPushNotification(title, body)
      break
    }
    case 'broadcast':
      showPushNotification(isEn ? 'Broadcast' : '广播消息', (message.message as string) || '')
      break
    case 'notification':
      showPushNotification(isEn ? 'Notice' : '通知', (message.message as string) || '')
      break
    case 'connected':
      break
  }
}

function ensureIpcSubscribed(): void {
  if (ipcSubscribed) return
  ipcSubscribed = true
  window.api.onAuthLoginSuccess(handleLoginSuccess)
  window.api.onAuthLogoutEvent(handleLogoutEvent)
  window.api.onSsePushMessage(handleSsePushMessage)
  window.addEventListener('focus', () => {
    if (currentUser.value) void checkStatus()
  })
}

export function useAuth() {
  async function login(): Promise<void> {
    try {
      const result = await window.api.authLogin(appSettings.language)
      if (!result.ok) {
        throw new Error(result.message || '无法启动登录')
      }
    } catch (err) {
      console.error('[useAuth] 打开登录窗口失败:', err)
      throw err
    }
  }

  async function logout(): Promise<void> {
    const result = await window.api.authLogout()
    if (!result.ok) {
      throw new Error(result.message || '登出失败')
    }
    currentUser.value = null
  }

  onMounted(() => {
    void checkStatus()
    ensureIpcSubscribed()
  })

  return {
    currentUser,
    isLoggedIn,
    isHydrating,
    login,
    logout,
    checkStatus,
  }
}
