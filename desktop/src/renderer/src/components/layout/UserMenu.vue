<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { openConfiguredUrl } from '../../api/runtime-config'
import DesignIcon from '../base/DesignIcon.vue'
import UserAvatar from '../base/UserAvatar.vue'
import DropdownChevron from '../base/DropdownChevron.vue'

const emit = defineEmits<{ update: [] }>()
const router = useRouter()
const { currentLang, setLang, label } = useI18n()
const { currentUser, isLoggedIn, isHydrating, login, logout } = useAuth()
const menuOpen = ref(false),
  languageOpen = ref(false),
  pending = ref(false),
  error = ref('')
const root = ref<HTMLElement | null>(null),
  trigger = ref<HTMLButtonElement | null>(null),
  menu = ref<HTMLElement | null>(null)
const name = computed(
  () =>
    currentUser.value?.nickname || currentUser.value?.username || label('Not signed in', '未登录'),
)
const initial = computed(() => name.value.charAt(0).toUpperCase())
function close(focus = false): void {
  menuOpen.value = false
  languageOpen.value = false
  if (focus) trigger.value?.focus()
}
async function toggle(focus = false): Promise<void> {
  if (isHydrating.value) return
  menuOpen.value = !menuOpen.value
  languageOpen.value = false
  error.value = ''
  if (menuOpen.value && focus) {
    await nextTick()
    menu.value?.querySelector<HTMLButtonElement>('button')?.focus()
  }
}
async function authenticate(): Promise<void> {
  if (pending.value) return
  pending.value = true
  error.value = ''
  try {
    if (isLoggedIn.value) await logout()
    else await login()
    close()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    pending.value = false
  }
}
async function website(): Promise<void> {
  try {
    await openConfiguredUrl('websiteUrl')
    close()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
}
function changeLanguage(value: 'zh' | 'en'): void {
  setLang(value)
  close(true)
}
function update(): void {
  close(true)
  emit('update')
}
function outside(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) close()
}
function keyboard(event: KeyboardEvent): void {
  if (!menuOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close(true)
    return
  }
  if (event.key === 'Tab') {
    close()
    return
  }
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  const options = Array.from(
    menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
  )
  const index = options.indexOf(document.activeElement as HTMLButtonElement)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length
  event.preventDefault()
  options[next]?.focus()
}
onMounted(() => document.addEventListener('pointerdown', outside))
onUnmounted(() => document.removeEventListener('pointerdown', outside))
watch(
  () => router.currentRoute.value.path,
  () => close(),
)
watch(isLoggedIn, () => close())
</script>

<template>
  <div ref="root" class="account-menu" @keydown="keyboard">
    <button
      ref="trigger"
      class="account-trigger"
      :class="{ 'account-trigger--open': menuOpen }"
      type="button"
      :disabled="isHydrating"
      :aria-busy="isHydrating"
      aria-haspopup="menu"
      :aria-expanded="menuOpen"
      :aria-label="name"
      @click="toggle()"
      @keydown.down.prevent="toggle(true)"
      @keydown.up.prevent="toggle(true)"
    >
      <span class="account-avatar">
        <UserAvatar
          v-if="isLoggedIn"
          :src="currentUser?.avatar"
          :fallback="initial"
          aria-hidden="true"
        />
        <DesignIcon v-else name="person" :size="16" />
      </span>
      <span class="account-name">{{ isHydrating ? label('Loading…', '正在加载…') : name }}</span>
    </button>
    <Transition name="account-pop">
      <div
        v-if="menuOpen"
        ref="menu"
        class="account-popover selection-list"
        role="menu"
        :aria-label="label('Account menu', '账号菜单')"
      >
        <button type="button" role="menuitem" @click="website">
          <DesignIcon name="globe" :size="16" />
          <span>{{ label('Website', '官网') }}</span>
          <DesignIcon name="externalLink" :size="14" />
        </button>
        <div class="account-language">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            :aria-expanded="languageOpen"
            @click="languageOpen = !languageOpen"
            @keydown.right.prevent="languageOpen = true"
          >
            <DesignIcon name="globe" :size="16" />
            <span>{{ label('Interface language', '界面语言') }}</span>
            <DropdownChevron :open="languageOpen" direction="right" />
          </button>
          <Transition name="account-pop">
            <div
              v-if="languageOpen"
              class="account-language-menu selection-list"
              role="menu"
              :aria-label="label('Interface language', '界面语言')"
            >
              <button
                role="menuitemradio"
                :aria-checked="currentLang === 'zh'"
                type="button"
                @click="changeLanguage('zh')"
              >
                <span>简体中文</span>
                <DesignIcon v-if="currentLang === 'zh'" name="check" :size="14" />
              </button>
              <button
                role="menuitemradio"
                :aria-checked="currentLang === 'en'"
                type="button"
                @click="changeLanguage('en')"
              >
                <span>English</span>
                <DesignIcon v-if="currentLang === 'en'" name="check" :size="14" />
              </button>
            </div>
          </Transition>
        </div>
        <div class="account-divider" role="separator" />
        <button type="button" role="menuitem" aria-haspopup="dialog" @click="update">
          <DesignIcon name="update" :size="16" />
          <span>{{ label('Update', '更新') }}</span>
        </button>
        <div class="account-divider" role="separator" />
        <button type="button" role="menuitem" :disabled="pending" @click="authenticate">
          <DesignIcon :name="isLoggedIn ? 'logout' : 'login'" :size="16" />
          <span>{{ isLoggedIn ? label('Sign out', '退出登录') : label('Sign in', '登录') }}</span>
        </button>
        <p v-if="error" class="account-error" role="alert">{{ error }}</p>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.account-menu {
  flex: 1;
  min-width: 0;
  position: relative;
}
.account-trigger {
  width: 100%;
  height: 40px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
.account-trigger:hover,
.account-trigger--open {
  background: var(--bg-hover);
}
.account-trigger:disabled {
  opacity: 0.6;
  cursor: default;
}
.account-avatar {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--surface-low);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
}
.account-name {
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-popover,
.account-language-menu {
  position: absolute;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-low);
  box-shadow: var(--shadow-popover);
}
.account-popover {
  bottom: calc(100% + 8px);
  left: 0;
  width: 196px;
  z-index: 100;
}
.account-popover button {
  display: flex;
  align-items: center;
  width: 100%;
  height: 34px;
  padding: 0 8px;
  gap: 8px;
  border: 0;
  border-radius: 6px;
  text-align: left;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}
.account-popover button > span:not(.design-icon, .dropdown-chevron) {
  flex: 1;
  white-space: nowrap;
}
.account-popover button:hover {
  background: var(--bg-hover);
}
.account-popover .design-icon {
  color: var(--text-muted);
}
.account-divider {
  height: 1px;
  margin: 2px 0;
  background: var(--border);
}
.account-language {
  position: relative;
}
.account-language-menu {
  left: calc(100% + 8px);
  top: 0;
  width: 160px;
}
.account-error {
  margin: 8px;
  font-size: 12px;
  color: var(--error);
  overflow-wrap: anywhere;
}
.account-pop-enter-active,
.account-pop-leave-active {
  transition:
    opacity var(--motion-popover) var(--motion-ease),
    transform var(--motion-popover) var(--motion-ease);
}
.account-pop-enter-from,
.account-pop-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
