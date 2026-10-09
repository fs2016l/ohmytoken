import type { DesktopUserInfo } from '@shared/desktop-api'
import { computed, onMounted, ref } from 'vue'
import { useAppSettings } from './useAppSettings'

const { settings: appSettings } = useAppSettings()
export type UserInfo = DesktopUserInfo

const currentUser = ref<UserInfo | null>(null)
const isHydrating = ref(true)
let firstCheckDone = false
let authRevision = 0
let initialCheckStarted = false

const isLoggedIn = computed(() => currentUser.value !== null)

async function checkStatus(): Promise<void> {
  const revision = authRevision
  try {
    const session = await window.api.authSession()
    if (revision !== authRevision) return
    switch (session.status) {
      case 'authenticated':
        currentUser.value = session.user
        return
      case 'anonymous':
        currentUser.value = null
        return
      case 'invalid':
        // Only the main-process refresh flow invalidates credentials. A stale renderer result
        // must never revoke a newer login session.
        currentUser.value = null
        return
      case 'unavailable':
        if (session.cachedUser) currentUser.value = session.cachedUser
        console.warn('[useAuth] 暂时无法验证登录状态:', session.message ?? '服务暂时不可用')
    }
  } catch (error) {
    console.warn('[useAuth] 登录状态暂时不可用:', error)
  } finally {
    if (!firstCheckDone) {
      firstCheckDone = true
      isHydrating.value = false
    }
  }
}

let ipcSubscribed = false

function handleLoginSuccess(): void {
  authRevision++
  currentUser.value = null
  void checkStatus()
}

function handleLogoutEvent(): void {
  authRevision++
  currentUser.value = null
}

function ensureIpcSubscribed(): void {
  if (ipcSubscribed) return
  ipcSubscribed = true
  window.api.onAuthLoginSuccess(handleLoginSuccess)
  window.api.onAuthLogoutEvent(handleLogoutEvent)
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
    authRevision++
    const result = await window.api.authLogout()
    if (!result.ok) {
      throw new Error(result.message || '登出失败')
    }
    currentUser.value = null
  }

  onMounted(() => {
    ensureIpcSubscribed()
    if (!initialCheckStarted) {
      initialCheckStarted = true
      void checkStatus()
    }
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
