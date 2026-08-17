<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from '../../i18n/useI18n'
import { useTheme } from '../../composables/useTheme'
import { useAuth } from '../../composables/useAuth'
import { useUpdater } from '../../composables/useUpdater'
import UserMenu from './UserMenu.vue'
import MessageBanner from '../message/MessageBanner.vue'
import BrandMark from '../base/BrandMark.vue'
import CloseBehaviorDialog from './CloseBehaviorDialog.vue'
import TrayUpdateDialog from './TrayUpdateDialog.vue'

const { currentLang, setLang, label, tr } = useI18n()
const { currentTheme, toggleTheme } = useTheme()
useAuth()

const isChangingFloatingWindow = ref(false)
const isFloatingWindowVisible = ref(false)
const floatingWindowActionLabel = computed(() =>
  isFloatingWindowVisible.value
    ? label('Close mini window', '关闭小窗')
    : label('Open mini window', '打开小窗'),
)

async function refreshFloatingWindowVisibility(): Promise<void> {
  try {
    isFloatingWindowVisible.value = await window.api.isFloatingWindowVisible()
  } catch (error) {
    console.error('[floating-window] 读取可见状态失败:', error)
  }
}

async function toggleFloatingWindow(): Promise<void> {
  if (isChangingFloatingWindow.value) return
  isChangingFloatingWindow.value = true
  try {
    const visible = await window.api.isFloatingWindowVisible()
    if (visible) {
      await window.api.closeFloatingWindow()
    } else {
      await window.api.showFloatingWindow()
    }
    isFloatingWindowVisible.value = !visible
  } catch (error) {
    console.error('[floating-window] 切换失败:', error)
    await refreshFloatingWindowVisibility()
  } finally {
    isChangingFloatingWindow.value = false
  }
}

function handleWindowFocus(): void {
  void refreshFloatingWindowVisibility()
}

// 版本号 + 更新流程
const updater = useUpdater({ versionFallback: '1.0.0', latestResetMs: 2000, errorResetMs: 2000 })
const currentVersion = updater.currentVersion
const updateStatus = updater.status
const newVersion = computed(() => updater.info.value?.version ?? '')
const downloadPercent = computed(() => Math.round(updater.percent.value))
const checkUpdate = updater.check
const startDownload = updater.download
const installNow = updater.install

// ===== 应用内通知（SSE 推送，持久化到 SQLite） =====
interface AppNotification {
  id: string
  title: string
  body: string
  icon: string
  timestamp: number
  read: boolean
}

/** 从 DB 加载的原始通知项（rawData 为服务端推送的原始 JSON） */
interface StoredNotification {
  id: string
  type: string
  read: boolean
  createdAt: number
  rawData: Record<string, unknown>
}

/** DB 原始数据（source of truth） */
const rawNotifications = ref<StoredNotification[]>([])

/**
 * 按当前语言从原始推送数据提取展示信息（纯函数，不生成 id/timestamp）。
 * 切语言时 computed 自动重算，全部通知立即切换语言。
 */
function formatNotificationDisplay(
  msg: Record<string, unknown>,
  isEn: boolean,
): { icon: string; title: string; body: string } {
  const type = msg.type as string
  if (type === 'news') {
    return {
      icon: 'newspaper',
      title: isEn
        ? (msg.titleEn as string) || (msg.titleZh as string) || 'News Update'
        : (msg.titleZh as string) || '新消息',
      body: isEn ? (msg.summaryEn as string) || '' : (msg.summaryZh as string) || '',
    }
  }
  if (type === 'plan') {
    const scope = msg.scope as string
    if (scope === 'provider') {
      const nameZh = (msg.providerNameZh as string) || ''
      const nameEn = (msg.providerNameEn as string) || nameZh
      return {
        icon: 'price_check',
        title: isEn ? 'Plan Update' : '套餐更新',
        body: isEn ? `${nameEn} plans updated` : `${nameZh} 套餐已更新`,
      }
    }
    return {
      icon: 'price_check',
      title: isEn ? 'Plan Update' : '套餐更新',
      body: isEn ? 'All plan list updated' : '套餐列表已更新',
    }
  }
  if (type === 'release') {
    return {
      icon: 'system_update',
      title: isEn ? `Update v${msg.version ?? ''}` : `版本更新 v${msg.version ?? ''}`,
      body: (msg.message as string) || (isEn ? 'New version available' : '有新版本可更新'),
    }
  }
  if (type === 'custom') {
    return {
      icon: 'campaign',
      title: isEn
        ? (msg.titleEn as string) || (msg.titleZh as string) || 'Message'
        : (msg.titleZh as string) || (msg.titleEn as string) || '消息通知',
      body: isEn
        ? (msg.contentEn as string) || (msg.contentZh as string) || ''
        : (msg.contentZh as string) || (msg.contentEn as string) || '',
    }
  }
  if (type === 'broadcast') {
    return {
      icon: 'campaign',
      title: isEn ? 'Broadcast' : '广播消息',
      body: (msg.message as string) || '',
    }
  }
  return {
    icon: 'notifications',
    title: isEn ? 'Notice' : '通知',
    body: (msg.message as string) || '',
  }
}

/** 格式化后的通知列表（依赖 currentLang，切语言时自动重算） */
const notifications = computed<AppNotification[]>(() =>
  rawNotifications.value.map((item) => ({
    id: item.id,
    ...formatNotificationDisplay(item.rawData, currentLang.value === 'en'),
    timestamp: item.createdAt,
    read: item.read,
  })),
)

const unreadCount = computed(() => notifications.value.filter((n) => !n.read).length)
const readCount = computed(() => notifications.value.filter((n) => n.read).length)
const showNotifyPanel = ref(false)
const notifyFilter = ref<'all' | 'unread' | 'read'>('unread')
const filteredNotifications = computed(() => {
  if (notifyFilter.value === 'all') return notifications.value
  return notifications.value.filter((n) => n.read === (notifyFilter.value === 'read'))
})

function toggleNotifyPanel(): void {
  showNotifyPanel.value = !showNotifyPanel.value
}

function closeNotifyPanel(e: MouseEvent): void {
  const target = e.target as HTMLElement
  if (showNotifyPanel.value && !target.closest('.notify-wrapper')) {
    showNotifyPanel.value = false
  }
}

async function markAsRead(n: AppNotification): Promise<void> {
  const raw = rawNotifications.value.find((r) => r.id === n.id)
  if (raw) raw.read = true
  try {
    await window.api.notificationsMarkRead(n.id)
  } catch (e) {
    console.error('[notify] 标记已读失败:', e)
  }
}

async function markAllRead(): Promise<void> {
  rawNotifications.value.forEach((r) => {
    r.read = true
  })
  try {
    await window.api.notificationsMarkAllRead()
  } catch (e) {
    console.error('[notify] 全部标记已读失败:', e)
  }
}

async function deleteStoredNotification(n: AppNotification): Promise<void> {
  const index = rawNotifications.value.findIndex((item) => item.id === n.id)
  if (index < 0) return

  rawNotifications.value.splice(index, 1)
  try {
    await window.api.notificationsDelete(n.id)
  } catch (e) {
    console.error('[notify] 删除通知失败:', e)
    await reloadNotifications()
  }
}

/** 从 DB 重新加载通知列表 */
async function reloadNotifications(): Promise<void> {
  try {
    rawNotifications.value = await window.api.notificationsList()
  } catch (e) {
    console.error('[notify] 加载通知列表失败:', e)
  }
}

/** SSE 推送回调：主进程已 INSERT 入库，重新加载即可 */
function onPushMessage(msg: Record<string, unknown>): void {
  if ((msg.type as string) === 'connected') return
  void reloadNotifications()
}

let unsubSse: (() => void) | null = null
let unsubFloatingWindowVisibility: (() => void) | null = null

onMounted(() => {
  void updater.init()
  void reloadNotifications()
  void refreshFloatingWindowVisibility()
  unsubFloatingWindowVisibility = window.api.onFloatingWindowVisibilityChanged((visible) => {
    isFloatingWindowVisible.value = visible
  })
  unsubSse = window.api.onSsePushMessage(onPushMessage)
  document.addEventListener('click', closeNotifyPanel)
  window.addEventListener('focus', handleWindowFocus)
})

onUnmounted(() => {
  document.removeEventListener('click', closeNotifyPanel)
  window.removeEventListener('focus', handleWindowFocus)
  if (unsubSse) unsubSse()
  unsubFloatingWindowVisibility?.()
  unsubFloatingWindowVisibility = null
})
</script>

<template>
  <div class="agent-dashboard">
    <aside class="side-nav">
      <div class="brand">
        <div class="brand-mark">
          <BrandMark />
        </div>
        <div>
          <h1>{{ tr('brandTitle') }}</h1>
        </div>
      </div>

      <nav class="nav-tabs" aria-label="Primary navigation">
        <router-link class="nav-item" active-class="active" to="/agent">
          <span class="material-symbols-outlined filled-icon">dashboard</span>
          {{ tr('navAgent') }}
        </router-link>
        <router-link class="nav-item" active-class="active" to="/token">
          <span class="material-symbols-outlined">analytics</span>
          {{ tr('navToken') }}
        </router-link>
        <router-link class="nav-item" active-class="active" to="/codingplan">
          <span class="material-symbols-outlined">receipt_long</span>
          {{ tr('navPlan') }}
        </router-link>
        <router-link class="nav-item" active-class="active" to="/agent-download">
          <span class="material-symbols-outlined">download_for_offline</span>
          {{ tr('navAgentDownload') }}
        </router-link>
        <router-link class="nav-item" active-class="active" to="/insight">
          <span class="material-symbols-outlined">insights</span>
          {{ tr('navInsight') }}
        </router-link>
        <router-link class="nav-item" active-class="active" to="/settings">
          <span class="material-symbols-outlined">settings</span>
          {{ tr('settingsNav') }}
        </router-link>
      </nav>

      <div class="side-footer">
        <div class="version-row">
          <span class="version-text">v{{ currentVersion || '...' }}</span>

          <button
            v-if="updateStatus === 'idle'"
            class="update-pill"
            type="button"
            @click="checkUpdate"
          >
            <span class="material-symbols-outlined">refresh</span>
            {{ tr('checkUpdate') }}
          </button>

          <button
            v-else-if="updateStatus === 'checking'"
            class="update-pill"
            type="button"
            disabled
          >
            <span class="material-symbols-outlined spinning">autorenew</span>
            {{ tr('checkingUpdate') }}
          </button>

          <button
            v-else-if="updateStatus === 'available'"
            class="update-pill update-pill--primary"
            type="button"
            @click="startDownload"
          >
            <span class="material-symbols-outlined">download</span>
            v{{ newVersion }}
          </button>

          <button
            v-else-if="updateStatus === 'downloading'"
            class="update-pill"
            type="button"
            disabled
          >
            <span class="material-symbols-outlined spinning">downloading</span>
            {{ downloadPercent }}%
          </button>

          <button
            v-else-if="updateStatus === 'downloaded'"
            class="update-pill update-pill--primary"
            type="button"
            @click="installNow"
          >
            <span class="material-symbols-outlined">restart_alt</span>
            {{ tr('updateInstall') }}
          </button>

          <span v-else-if="updateStatus === 'latest'" class="update-pill update-pill--static">
            <span class="material-symbols-outlined">check_circle</span>
            {{ tr('upToDate') }}
          </span>

          <button v-else class="update-pill" type="button" @click="checkUpdate">
            <span class="material-symbols-outlined">refresh</span>
            {{ tr('updateRetry') }}
          </button>
        </div>
      </div>
    </aside>

    <div class="app-shell">
      <header class="top-bar">
        <div class="top-title">
          <MessageBanner class="top-message-banner" placement="main" />
          <span class="mobile-brand">{{ tr('agentDashboard') }}</span>
        </div>

        <div class="top-actions">
          <button
            class="icon-btn floating-window-toggle"
            :class="{ 'floating-window-toggle--active': isFloatingWindowVisible }"
            type="button"
            :disabled="isChangingFloatingWindow"
            :aria-label="floatingWindowActionLabel"
            :aria-pressed="isFloatingWindowVisible"
            :title="floatingWindowActionLabel"
            @click="toggleFloatingWindow"
          >
            <span class="material-symbols-outlined">picture_in_picture_alt</span>
            <span class="floating-window-toggle__label">{{ floatingWindowActionLabel }}</span>
          </button>
          <div class="lang-switch">
            <button :class="{ active: currentLang === 'en' }" type="button" @click="setLang('en')">
              English
            </button>
            <button :class="{ active: currentLang === 'zh' }" type="button" @click="setLang('zh')">
              中文
            </button>
          </div>
          <button
            class="icon-btn theme-toggle"
            type="button"
            :aria-label="
              currentTheme === 'dark'
                ? label('Switch to light mode', '切换到亮色模式')
                : label('Switch to dark mode', '切换到暗色模式')
            "
            @click="toggleTheme"
          >
            <span class="material-symbols-outlined">
              {{ currentTheme === 'dark' ? 'light_mode' : 'dark_mode' }}
            </span>
          </button>
          <div class="notify-wrapper">
            <button
              class="icon-btn"
              type="button"
              aria-label="Notifications"
              @click.stop="toggleNotifyPanel"
            >
              <span class="material-symbols-outlined">notifications</span>
              <span v-if="unreadCount > 0" class="notify-badge">
                {{ unreadCount > 99 ? '99+' : unreadCount }}
              </span>
            </button>
            <Transition name="notify-fade">
              <div v-if="showNotifyPanel" class="notify-panel">
                <div v-if="notifications.length === 0" class="notify-empty">
                  {{ currentLang === 'en' ? 'No notifications' : '暂无通知' }}
                </div>
                <template v-else>
                  <div class="notify-header">
                    <button
                      class="notify-tab"
                      :class="{ active: notifyFilter === 'unread' }"
                      @click="notifyFilter = 'unread'"
                    >
                      {{ currentLang === 'en' ? 'Unread' : '未读' }}
                      <span v-if="unreadCount > 0" class="tab-count">{{ unreadCount }}</span>
                    </button>
                    <button
                      class="notify-tab"
                      :class="{ active: notifyFilter === 'read' }"
                      @click="notifyFilter = 'read'"
                    >
                      {{ currentLang === 'en' ? 'Read' : '已读' }}
                      <span v-if="readCount > 0" class="tab-count">{{ readCount }}</span>
                    </button>
                    <button
                      class="notify-tab"
                      :class="{ active: notifyFilter === 'all' }"
                      @click="notifyFilter = 'all'"
                    >
                      {{ currentLang === 'en' ? 'All' : '全部' }}
                      <span class="tab-count">{{ notifications.length }}</span>
                    </button>
                    <button class="notify-clear" @click="markAllRead">
                      {{ currentLang === 'en' ? 'Mark all as read' : '全部标记已读' }}
                    </button>
                  </div>
                  <div v-if="filteredNotifications.length === 0" class="notify-empty">
                    {{ currentLang === 'en' ? 'Nothing here' : '暂无内容' }}
                  </div>
                  <div
                    v-for="n in filteredNotifications"
                    :key="n.id"
                    class="notify-item"
                    :class="{ unread: !n.read }"
                    @click.stop="markAsRead(n)"
                  >
                    <span class="material-symbols-outlined notify-icon">{{ n.icon }}</span>
                    <div class="notify-content">
                      <div class="notify-title">{{ n.title }}</div>
                      <div v-if="n.body" class="notify-body">{{ n.body }}</div>
                    </div>
                    <div class="notify-item-actions">
                      <span v-if="!n.read" class="unread-dot"></span>
                      <button
                        class="notify-delete"
                        type="button"
                        :title="currentLang === 'en' ? 'Delete' : '删除'"
                        :aria-label="currentLang === 'en' ? 'Delete notification' : '删除通知'"
                        @click.stop="deleteStoredNotification(n)"
                      >
                        <span class="material-symbols-outlined">delete</span>
                      </button>
                    </div>
                  </div>
                </template>
              </div>
            </Transition>
          </div>
          <UserMenu />
        </div>
      </header>

      <router-view v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </div>
  </div>
  <CloseBehaviorDialog />
  <TrayUpdateDialog />
</template>

<style scoped>
.agent-dashboard {
  min-height: 100vh;
  background: var(--bg-base);
  color: var(--text);
}

.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 20px;
  line-height: 1;
  letter-spacing: 0;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  font-feature-settings: 'liga';
  -webkit-font-feature-settings: 'liga';
  -webkit-font-smoothing: antialiased;
  font-variation-settings:
    'FILL' 0,
    'wght' 400,
    'GRAD' 0,
    'opsz' 24;
}

.filled-icon {
  font-variation-settings:
    'FILL' 1,
    'wght' 500,
    'GRAD' 0,
    'opsz' 24;
}

button,
input {
  font: inherit;
}

button {
  cursor: pointer;
}

.side-nav {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 50;
  width: 256px;
  display: flex;
  flex-direction: column;
  padding: 24px 16px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.04);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 48px;
}

.brand-mark {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 8px;
  background:
    radial-gradient(circle at 30% 20%, rgba(208, 188, 255, 0.5), transparent 34%),
    linear-gradient(135deg, #2a2a2c, #151518);
  color: var(--primary);
  border: 1px solid var(--border-strong);
}

:root[data-theme='light'] .brand-mark {
  background:
    radial-gradient(circle at 30% 20%, rgba(109, 59, 215, 0.12), transparent 34%),
    linear-gradient(135deg, #f5f3ff, #ede9fe);
}

.brand h1 {
  color: var(--primary);
  font-size: 24px;
  line-height: 32px;
  font-weight: var(--weight-semibold);
  margin: 0;
}

.brand p {
  margin: 0;
  color: var(--text-soft);
  font-size: 12px;
  line-height: 18px;
}

.nav-tabs {
  display: grid;
  gap: 8px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 8px;
  color: var(--text-muted);
  text-decoration: none;
  border-radius: 4px;
  border-right: 2px solid transparent;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.nav-item:hover {
  background: var(--surface-container-high);
  color: var(--text);
}

.nav-item.active {
  color: var(--primary);
  font-weight: var(--weight-semibold);
  border-right-color: var(--primary);
}

.side-footer {
  margin-top: auto;
  padding-top: 24px;
  border-top: 1px solid var(--border-strong);
}

.version-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.version-text {
  font-size: 15px;
  color: var(--text-muted);
  text-align: center;
  font-family: var(--font-mono);
  font-weight: var(--weight-semibold);
}

.update-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  background: var(--surface-container-high);
  color: var(--text);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    opacity 0.15s ease;
  width: 100%;
  min-height: 38px;
}

.update-pill .material-symbols-outlined {
  font-size: 20px;
}

.update-pill:hover:not(:disabled):not(.update-pill--static) {
  background: var(--surface-bright);
}

.update-pill:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.update-pill--primary {
  background: var(--primary);
  color: var(--primary-on);
}

.update-pill--primary:hover:not(:disabled) {
  opacity: 0.9;
}

.update-pill--static {
  cursor: default;
}

.spinning {
  animation: btn-spin 1s linear infinite;
}

@keyframes btn-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.app-shell {
  min-height: 100vh;
  margin-left: 256px;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
}

.top-bar {
  position: sticky;
  top: 0;
  z-index: 40;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 24px;
  background: var(--bg-glass);
  backdrop-filter: blur(18px);
  border-bottom: 1px solid var(--border);
}

.top-title,
.top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.top-title {
  flex: 1;
  min-width: 0;
}

.top-actions {
  flex: 0 0 auto;
}

.top-message-banner {
  width: min(960px, 100%);
}

.mobile-brand {
  display: none;
  color: var(--text);
  font-weight: var(--weight-semibold);
  font-size: 20px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  width: min(480px, 42vw);
  padding: 0 12px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-soft);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.search-box:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(208, 188, 255, 0.1);
}

.search-box input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
}

.search-box input::placeholder {
  color: var(--text-soft);
}

.icon-btn {
  position: relative;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--text-muted);
  background: transparent;
  border: 0;
  border-radius: 999px;
}

.icon-btn:hover {
  color: var(--text);
  background: var(--surface-container-high);
}

.notify-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--error, #ef4444);
  color: #fff;
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
  line-height: 16px;
  text-align: center;
  animation: notify-pulse 1.5s ease-in-out infinite;
}

@keyframes notify-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.3);
    opacity: 0.7;
  }
}

.notify-wrapper {
  position: relative;
}

.notify-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 360px;
  max-height: 420px;
  overflow-y: auto;
  background: var(--bg-elevated, var(--bg-card, #1e1e2e));
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  z-index: 100;
  padding: 8px;
}

.notify-empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-secondary, #888);
  font-size: 14px;
}

.notify-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px 8px;
  border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.06));
  margin-bottom: 4px;
}

.notify-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #888);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.notify-tab.active {
  background: var(--accent, #6366f1);
  color: #fff;
}

.notify-tab:hover:not(.active) {
  background: var(--bg-hover, rgba(255, 255, 255, 0.06));
}

.tab-count {
  font-size: var(--type-caption);
  padding: 0 5px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.15);
  line-height: 16px;
}

.notify-tab.active .tab-count {
  background: rgba(255, 255, 255, 0.25);
}

.notify-clear {
  margin-left: auto;
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #888);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.notify-clear:hover {
  color: var(--error, #ef4444);
}

.unread-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent, #6366f1);
  align-self: center;
}

.notify-item-actions {
  display: flex;
  flex-shrink: 0;
  align-self: center;
  align-items: center;
  gap: 6px;
}

.notify-delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--text-secondary, #888);
  background: transparent;
  border: 0;
  border-radius: 7px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.notify-delete .material-symbols-outlined {
  font-size: 18px;
}

.notify-delete:hover {
  color: var(--error, #ef4444);
  background: color-mix(in srgb, var(--error, #ef4444) 10%, transparent);
}

.notify-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  transition: background 0.15s;
  border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.06));
}

.notify-item:last-child {
  border-bottom: none;
}

.notify-item:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.04));
}

.notify-item.unread {
  background: var(--bg-hover, rgba(99, 102, 241, 0.08));
}

.notify-icon {
  flex-shrink: 0;
  font-size: 20px;
  color: var(--accent, #6366f1);
}

.notify-content {
  flex: 1;
  min-width: 0;
}

.notify-title {
  font-size: 14px;
  font-weight: var(--weight-medium);
  color: var(--text, #e0e0e0);
  margin-bottom: 2px;
}

.notify-body {
  font-size: 13px;
  color: var(--text-secondary, #999);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.notify-fade-enter-active,
.notify-fade-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}

.notify-fade-enter-from,
.notify-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

@media (max-width: 820px) {
  .side-nav {
    display: none;
  }

  .app-shell {
    margin-left: 0;
  }

  .top-bar {
    padding: 0 16px;
  }

  .mobile-brand {
    display: inline;
  }

  .search-box {
    display: none;
  }
}
</style>
