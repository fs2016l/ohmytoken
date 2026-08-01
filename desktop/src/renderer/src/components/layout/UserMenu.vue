<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { openConfiguredUrl } from '../../api/runtime-config'
import UserAvatar from '../base/UserAvatar.vue'

const router = useRouter()
const { tr } = useI18n()
const { currentUser, isLoggedIn, isHydrating, login, logout } = useAuth()

const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)

/** 首字母：取 nickname 或 username 首字符（中文首字 / 英文首字母大写） */
const initial = computed(() => {
  const name = currentUser.value?.nickname || currentUser.value?.username || ''
  if (!name) return '?'
  return name.charAt(0).toUpperCase()
})

/** aria-label：动态反映触发器当前状态，供屏幕阅读器播报 */
const triggerLabel = computed(() => {
  if (isHydrating.value) return tr('checkingAuth')
  if (isLoggedIn.value) {
    const name = currentUser.value?.nickname || currentUser.value?.username || ''
    return `${tr('loggedInAs')} ${name}`
  }
  return tr('notLoggedIn')
})

/** 仅首次恢复登录态时禁用；浏览器登录期间头像始终可再次操作。 */
const triggerDisabled = computed(() => isHydrating.value)

/** 触发器视觉态枚举，驱动 v-if 分支与 CSS class */
type TriggerVisual = 'skeleton' | 'logged-in' | 'guest'
const triggerVisual = computed<TriggerVisual>(() => {
  if (isHydrating.value) return 'skeleton'
  if (isLoggedIn.value) return 'logged-in'
  return 'guest'
})

let closeTimer: number | null = null

function closeMenu(): void {
  menuOpen.value = false
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer)
    closeTimer = null
  }
}

/** 鼠标移入：首次恢复登录态完成后展开菜单。 */
function handleEnter(): void {
  if (triggerDisabled.value) return
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer)
    closeTimer = null
  }
  menuOpen.value = true
}

/** 鼠标移出：延迟收起（150ms 容错，防鼠标跨越边缘时的抖动） */
function handleLeave(): void {
  closeTimer = window.setTimeout(() => {
    menuOpen.value = false
    closeTimer = null
  }, 150)
}

async function doLogin(): Promise<void> {
  closeMenu()
  try {
    await login()
  } catch (err) {
    console.error('[UserMenu] 打开登录窗口失败:', err)
  }
}

async function doLogout(): Promise<void> {
  closeMenu()
  try {
    await logout()
  } catch (err) {
    console.error('[UserMenu] 登出失败:', err)
  }
}

/** 跳转 com 账号详情页（系统浏览器打开） */
function openAccountDetails(): void {
  closeMenu()
  void openConfiguredUrl('accountPageUrl').catch((error) => {
    console.error('[UserMenu] 打开账号中心失败:', error)
  })
}

/** ESC 关闭菜单 */
function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && menuOpen.value) {
    closeMenu()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer)
  }
})

// 路由切换时关闭菜单（避免菜单跨页面残留）
watch(
  () => router.currentRoute.value.path,
  () => closeMenu(),
)

watch(isLoggedIn, () => closeMenu())
</script>

<template>
  <div ref="menuRef" class="user-menu" @mouseenter="handleEnter" @mouseleave="handleLeave">
    <button
      class="avatar-trigger"
      :class="`avatar-trigger--${triggerVisual}`"
      :disabled="triggerDisabled"
      :aria-label="triggerLabel"
      :aria-busy="isHydrating"
      aria-haspopup="menu"
      :aria-expanded="menuOpen"
      type="button"
    >
      <span v-if="triggerVisual === 'skeleton'" class="skeleton-pulse" aria-hidden="true"></span>
      <UserAvatar
        v-else-if="triggerVisual === 'logged-in'"
        :src="currentUser?.avatar"
        :fallback="initial"
        aria-hidden="true"
      />
      <span v-else class="material-symbols-outlined" aria-hidden="true">person_add</span>
    </button>

    <transition name="menu-pop">
      <div v-if="menuOpen" class="user-popover" role="menu">
        <!-- 已登录菜单 -->
        <template v-if="isLoggedIn">
          <div class="popover-header">
            <div class="header-avatar">
              <UserAvatar
                :src="currentUser?.avatar"
                :fallback="initial"
                :alt="currentUser?.nickname || currentUser?.username || ''"
              />
            </div>
            <div class="header-info">
              <div class="header-name">{{ currentUser?.nickname || currentUser?.username }}</div>
              <div class="header-username">@{{ currentUser?.username }}</div>
            </div>
          </div>
          <div class="popover-divider"></div>
          <button class="menu-item" role="menuitem" type="button" @click="openAccountDetails">
            <span class="material-symbols-outlined">person</span>
            {{ tr('accountDetails') }}
          </button>
          <div class="popover-divider"></div>
          <button
            class="menu-item menu-item--danger"
            role="menuitem"
            type="button"
            @click="doLogout"
          >
            <span class="material-symbols-outlined">logout</span>
            {{ tr('logout') }}
          </button>
        </template>

        <!-- 未登录菜单（方案 C 增强版：状态说明 + 登录 CTA + 设置） -->
        <template v-else>
          <div class="popover-header">
            <div class="header-avatar header-avatar--guest">
              <span class="material-symbols-outlined">person_add</span>
            </div>
            <div class="header-info">
              <div class="header-name">{{ tr('guestLabel') }}</div>
              <div class="header-desc">{{ tr('loginValueHint') }}</div>
            </div>
          </div>
          <div class="popover-divider"></div>
          <button
            class="menu-item menu-item--primary"
            role="menuitem"
            type="button"
            @click="doLogin"
          >
            <span class="material-symbols-outlined">login</span>
            {{ tr('loginBtn') }}
          </button>
        </template>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 18px;
  line-height: 1;
  letter-spacing: 0;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
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

.user-menu {
  position: relative;
  display: inline-flex;
}

.avatar-trigger {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    opacity 0.15s ease;
}

.avatar-trigger:hover:not(:disabled) {
  background: var(--surface-container-high);
}

.avatar-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

/* skeleton：灰色脉动圆（启动水合） */
.avatar-trigger--skeleton {
  background: var(--surface-container-high);
  border-color: var(--border);
}

.skeleton-pulse {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--text-muted);
  animation: skeleton-pulse 1.2s ease-in-out infinite;
}

@keyframes skeleton-pulse {
  0%,
  100% {
    opacity: 0.3;
    transform: scale(0.85);
  }
  50% {
    opacity: 0.6;
    transform: scale(1);
  }
}

/* 已登录：渐变圆 + 首字母（复用 AppLayout 原 profile-dot 视觉语言） */
.avatar-trigger--logged-in {
  background: linear-gradient(135deg, #2a2a2c, #5516be);
  color: var(--primary);
  border-color: var(--border-strong);
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
}

:root[data-theme='light'] .avatar-trigger--logged-in {
  background: linear-gradient(135deg, #f5f3ff, #ede9fe);
  color: var(--primary-deep);
}

.avatar-initial {
  font-weight: var(--weight-semibold);
}

/* 未登录：虚线圆 + person_add 图标（与已登录形成视觉对比，一眼可辨） */
.avatar-trigger--guest {
  background: transparent;
  border-style: dashed;
  color: var(--text-muted);
}

.avatar-trigger--guest:hover:not(:disabled) {
  color: var(--primary);
  border-color: var(--primary);
}

.avatar-trigger--guest .material-symbols-outlined {
  font-size: 16px;
}

/* popover 下拉菜单 */
.user-popover {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 60;
  min-width: 240px;
  padding: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);
}

.popover-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
}

.header-avatar {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: linear-gradient(135deg, #2a2a2c, #5516be);
  color: var(--primary);
  border: 1px solid var(--border-strong);
  font-size: 13px;
  font-weight: var(--weight-semibold);
}

:root[data-theme='light'] .header-avatar {
  background: linear-gradient(135deg, #f5f3ff, #ede9fe);
  color: var(--primary-deep);
}

.header-avatar--guest {
  background: var(--surface-container-high);
  color: var(--text-muted);
}

.header-info {
  min-width: 0;
  flex: 1 1 auto;
}

.header-name {
  font-size: 14px;
  font-weight: var(--weight-semibold);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-username {
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 16px;
}

.popover-divider {
  height: 1px;
  margin: 6px 0;
  background: var(--border-strong);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    opacity 0.15s ease;
}

.menu-item:hover {
  background: var(--surface-container-high);
}

.menu-item .material-symbols-outlined {
  font-size: 18px;
  color: var(--text-muted);
}

/* 主色 CTA（未登录菜单的登录按钮） */
.menu-item--primary {
  background: var(--primary);
  color: var(--primary-on);
  font-weight: var(--weight-semibold);
}

.menu-item--primary:hover {
  opacity: 0.9;
  background: var(--primary);
}

.menu-item--primary .material-symbols-outlined {
  color: var(--primary-on);
}

/* 危险操作（退出登录） */
.menu-item--danger {
  color: var(--error);
}

.menu-item--danger:hover {
  background: rgba(220, 38, 38, 0.08);
}

.menu-item--danger .material-symbols-outlined {
  color: var(--error);
}

/* 进出场动画 */
.menu-pop-enter-active,
.menu-pop-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.menu-pop-enter-from,
.menu-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
