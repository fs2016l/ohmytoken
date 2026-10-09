<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  discoveryPageKey,
  type DiscoveryHostContext,
  type DiscoveryUiLocation,
} from '@shared/discovery-ui'
import { isDiscoveryBrowsingKey, validateDiscoveryCatalog } from '@shared/discovery-ui-validation'
import { validateAccountFavoriteTarget } from '@shared/account-favorites'
import { validateBrowsingPage } from '@shared/browsing-state'
import { useAuth } from '../../composables/useAuth'
import { useLoginPrompt } from '../../composables/useLoginPrompt'
import { useCostCurrency } from '../../composables/useCostCurrency'
import { useI18n } from '../../i18n/useI18n'
import {
  installDiscoveryHostBridge,
  type DiscoveryOverlay,
} from '../../utils/discovery-host-bridge'

const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{ overlay: [value: boolean] }>()
const route = useRoute(),
  router = useRouter()
const auth = useAuth(),
  login = useLoginPrompt(),
  { currency } = useCostCurrency()
const { currentLang, label } = useI18n()
const region = ref<HTMLElement | null>(null),
  frame = ref<HTMLIFrameElement | null>(null)
const location = shallowRef<DiscoveryUiLocation | null>(null)
const state = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const error = ref(''),
  generation = ref(0)
const overlay = shallowRef<DiscoveryOverlay>({ modal: false, popovers: [] })
const viewport = ref({ width: 0, height: 0, x: 0, y: 0, contentWidth: 0, contentHeight: 0 })
let lastRoute = '/insight',
  opened = false,
  sequence = 0,
  scheduled = 0
let deadline: ReturnType<typeof setTimeout> | undefined
let observer: ResizeObserver | undefined, appearanceObserver: MutationObserver | undefined
let removeFavorites: (() => void) | undefined
let bridge: ReturnType<typeof installDiscoveryHostBridge> | undefined

function measure(): void {
  // The frame keeps the whole window's viewport, preserving existing media queries and popovers.
  const rect = region.value?.parentElement?.getBoundingClientRect()
  if (!rect) return
  viewport.value = {
    width: innerWidth,
    height: innerHeight,
    x: rect.x,
    y: rect.y,
    contentWidth: rect.width,
    contentHeight: rect.height,
  }
}
function readingSize(kind: string): number | null {
  const value = Number(localStorage.getItem(kind + '-reading-size'))
  return [14, 16, 18, 20, 22, 24].includes(value) ? value : null
}
function context(): DiscoveryHostContext {
  const root = document.documentElement,
    style = getComputedStyle(root)
  const user = auth.currentUser.value
  return {
    route: lastRoute,
    active: props.active && state.value !== 'error',
    language: currentLang.value,
    currency: currency.value,
    readingSizes: { article: readingSize('article'), agent: readingSize('agent') },
    apiScope: location.value?.apiScope ?? '',
    auth: {
      user: user
        ? { id: user.id, username: user.username, nickname: user.nickname, avatar: user.avatar }
        : null,
      hydrating: auth.isHydrating.value,
    },
    appearance: {
      attributes: Object.fromEntries(
        [...root.attributes]
          .filter((item) => item.name.startsWith('data-') || ['class', 'dir'].includes(item.name))
          .map((item) => [item.name, item.value]),
      ),
      variables: Object.fromEntries(
        Array.from(style)
          .filter((name) => name.startsWith('--'))
          .map((name) => [name, style.getPropertyValue(name)]),
      ),
      fontStyles: location.value?.fontStyles ?? '',
    },
    viewport: { ...viewport.value },
  }
}
function schedule(): void {
  if (scheduled) return
  scheduled = requestAnimationFrame(() => {
    scheduled = 0
    measure()
    bridge?.context()
  })
}
function setOverlay(value: DiscoveryOverlay): void {
  overlay.value = value
  emit('overlay', props.active && value.modal)
}
function fail(message = ''): void {
  clearTimeout(deadline)
  state.value = 'error'
  error.value = message
  setOverlay({ modal: false, popovers: [] })
  schedule()
}
async function open(force = false): Promise<void> {
  const key = discoveryPageKey(route.path)
  if (!key || !props.active) return
  const ticket = ++sequence
  const desiredRoute = route.fullPath
  if (!navigator.onLine) {
    fail()
    return
  }
  if (!opened || force) state.value = 'loading'
  try {
    const result = await window.api.discoveryUiOpen(key, force)
    if (ticket !== sequence) return
    if (!result.ok) throw new Error(result.error.message)
    lastRoute = desiredRoute
    const changed = location.value?.url !== result.value.url
    location.value = result.value
    if (changed || force || !opened) {
      opened = false
      state.value = 'loading'
      bridge?.reset()
      generation.value++
      clearTimeout(deadline)
      deadline = setTimeout(() => fail(), 30_000)
    } else state.value = 'ready'
    await nextTick()
    schedule()
  } catch (failure) {
    if (ticket === sequence) fail(failure instanceof Error ? failure.message : '')
  }
}
async function execute(operation: string, input: unknown): Promise<unknown> {
  const args = input as Record<string, unknown>
  if (
    !props.active &&
    [
      'favoriteSet',
      'openExternal',
      'clipboardWrite',
      'requestLogin',
      'navigate',
      'currency',
      'readingSize',
    ].includes(operation)
  )
    throw new Error('Discovery page is inactive')
  switch (operation) {
    case 'catalog': {
      const result = await window.api.discoveryCatalog(validateDiscoveryCatalog(args))
      if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
      return result.value
    }
    case 'favoritesList':
      if (typeof args.remote !== 'boolean') break
      return window.api.accountFavoritesList(args.remote)
    case 'favoriteSet':
      if (typeof args.desired !== 'boolean') break
      return window.api.accountFavoriteSet(validateAccountFavoriteTarget(args.target), args.desired)
    case 'browsingRead':
      return Object.fromEntries(
        Object.entries(await window.api.readBrowsingState()).filter(([key]) =>
          isDiscoveryBrowsingKey(key),
        ),
      )
    case 'browsingWrite':
      if (!isDiscoveryBrowsingKey(args.key)) break
      return window.api.writeBrowsingState(args.key, validateBrowsingPage(args.key, args.value))
    case 'exchangeRates':
      if (typeof args.force !== 'boolean') break
      return window.api.getExchangeRates(args.force)
    case 'openExternal': {
      if (typeof args.url !== 'string' || args.url.length > 2048) break
      const url = new URL(args.url)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) break
      return window.api.openExternal(url.href)
    }
    case 'clipboardWrite':
      if (typeof args.text !== 'string' || args.text.length > 1_000_000) break
      return window.api.discoveryCopy(args.text)
    case 'requestLogin':
      return login.requestLogin()
    case 'navigate':
      if (
        typeof args.route !== 'string' ||
        args.route.length > 2048 ||
        !discoveryPageKey(args.route) ||
        typeof args.replace !== 'boolean'
      )
        break
      await router[args.replace ? 'replace' : 'push'](args.route)
      return
    case 'currency':
      if (args.currency !== 'USD' && args.currency !== 'CNY') break
      currency.value = args.currency
      return
    case 'readingSize':
      if (
        !['article', 'agent'].includes(String(args.kind)) ||
        ![14, 16, 18, 20, 22, 24].includes(Number(args.size))
      )
        break
      localStorage.setItem(args.kind + '-reading-size', String(args.size))
      schedule()
      return
  }
  throw new Error('Unsupported discovery operation or arguments')
}
const frameStyle = computed(() => {
  const view = viewport.value
  const rectangles = [
    { x: view.x, y: view.y, width: view.contentWidth, height: view.contentHeight },
    ...overlay.value.popovers,
  ]
  const path = rectangles.map((r) => `M${r.x} ${r.y}h${r.width}v${r.height}h${-r.width}Z`).join(' ')
  return {
    width: view.width + 'px',
    height: view.height + 'px',
    clipPath: overlay.value.modal ? 'none' : `path("${path}")`,
  }
})
watch(
  () => [props.active, route.fullPath] as const,
  ([active]) => {
    emit('overlay', active && overlay.value.modal)
    if (active) void open()
    else sequence++
    schedule()
  },
)
watch([currentLang, currency, auth.currentUser, auth.isHydrating], schedule, { deep: true })
function online(): void {
  if (props.active && state.value === 'error') void open(true)
}
function offline(): void {
  if (props.active) fail()
}
onMounted(() => {
  bridge = installDiscoveryHostBridge({
    frame: () => frame.value,
    origin: () => location.value?.origin,
    context,
    execute,
    ready: () => {
      opened = true
      clearTimeout(deadline)
      state.value = 'ready'
      schedule()
    },
    failed: () => fail(),
    overlay: setOverlay,
  })
  removeFavorites = window.api.onAccountFavoritesChanged((value) => bridge?.favorites(value))
  observer = new ResizeObserver(schedule)
  if (region.value?.parentElement) observer.observe(region.value.parentElement)
  appearanceObserver = new MutationObserver(schedule)
  appearanceObserver.observe(document.documentElement, { attributes: true })
  window.addEventListener('resize', schedule)
  window.addEventListener('online', online)
  window.addEventListener('offline', offline)
  measure()
  if (props.active) void open()
})
onBeforeUnmount(() => {
  sequence++
  clearTimeout(deadline)
  cancelAnimationFrame(scheduled)
  observer?.disconnect()
  appearanceObserver?.disconnect()
  bridge?.dispose()
  removeFavorites?.()
  window.removeEventListener('resize', schedule)
  window.removeEventListener('online', online)
  window.removeEventListener('offline', offline)
})
</script>

<template>
  <div v-show="active" ref="region" class="discovery-host" :aria-busy="state === 'loading'">
    <iframe
      v-if="location"
      v-show="state === 'ready'"
      :key="generation"
      ref="frame"
      class="discovery-frame"
      :src="location.url"
      :style="frameStyle"
      :title="label('Discover', '发现')"
      sandbox="allow-scripts allow-same-origin allow-forms"
      referrerpolicy="no-referrer"
    />
    <div
      v-if="state !== 'ready'"
      class="discovery-placeholder"
      :role="state === 'error' ? 'alert' : 'status'"
    >
      <span>
        {{
          state === 'error'
            ? label('Network interrupted or page unavailable.', '网络中断或页面暂时无法加载。')
            : label('Loading…', '加载中…')
        }}
      </span>
      <template v-if="state === 'error'">
        <small v-if="error">{{ error }}</small>
        <button class="workspace-button" type="button" @click="open(true)">
          {{ label('Retry', '重试') }}
        </button>
      </template>
    </div>
  </div>
</template>
<style scoped>
.discovery-host {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.discovery-frame {
  position: fixed;
  inset: 0;
  border: 0;
  z-index: 30;
  pointer-events: auto;
  background: transparent;
}
.discovery-placeholder {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
  color: var(--text-secondary);
  pointer-events: auto;
}
.discovery-placeholder small {
  max-width: min(560px, 90%);
  overflow-wrap: anywhere;
}
</style>
