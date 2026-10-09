import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import type {
  QuotaRefreshInterval,
  TokenPlanInventory,
  TokenPlanMonitorState,
  TokenPlanUsageSnapshot,
} from '../../../shared/token-plan'

const inventory = shallowRef<TokenPlanInventory | null>(null)
const snapshots = shallowRef<Record<string, TokenPlanUsageSnapshot>>({})
const refreshing = ref<Set<string>>(new Set())
const initializing = ref(false)
const loadFailed = ref(false)
const lastRefreshAt = ref(0)
const refreshInterval = ref<QuotaRefreshInterval>(0)
let revision = -1
let consumers = 0
let activeConsumers = 0
let unsubscribe: (() => void) | undefined

function apply(state: TokenPlanMonitorState): void {
  // A slow read/refresh response must not roll back a newer broadcast.
  if (state.revision < revision) return
  revision = state.revision
  inventory.value = state.inventory
  snapshots.value = Object.fromEntries(
    state.inventory.snapshots.map((row) => [row.connectionId, row]),
  )
  refreshing.value = new Set(state.refreshing)
  initializing.value = state.discovering
  refreshInterval.value = state.refreshInterval
  loadFailed.value = !!state.error
}

async function receive(request: Promise<TokenPlanMonitorState>): Promise<void> {
  try {
    apply(await request)
  } catch {
    loadFailed.value = true
  }
}

export async function refreshTokenPlanUsage(id?: string): Promise<boolean> {
  await receive(window.api.tokenPlanMonitorRefresh(id))
  lastRefreshAt.value = Date.now()
  return !loadFailed.value
}
function setRefreshInterval(value: number): Promise<void> {
  return receive(window.api.tokenPlanMonitorSetInterval(value))
}
function visibility(): void {
  void window.api.tokenPlanMonitorSetActive(activeConsumers > 0 && !document.hidden).catch(() => {
    loadFailed.value = true
  })
}

export function useTokenPlanUsage() {
  let active = false
  function start(): void {
    if (active) return
    active = true
    activeConsumers++
    visibility()
    void receive(window.api.tokenPlanMonitorRead())
  }
  function stop(): void {
    if (!active) return
    active = false
    activeConsumers--
    visibility()
  }
  onMounted(() => {
    if (++consumers === 1) {
      unsubscribe = window.api.onTokenPlanMonitorChanged(apply)
      document.addEventListener('visibilitychange', visibility)
    }
    start()
  })
  onActivated(start)
  onDeactivated(stop)
  onUnmounted(() => {
    stop()
    if (--consumers === 0) {
      unsubscribe?.()
      unsubscribe = undefined
      document.removeEventListener('visibilitychange', visibility)
    }
  })
  return {
    inventory,
    snapshots,
    refreshing,
    initializing,
    loadFailed,
    lastRefreshAt,
    refreshAll: () => refreshTokenPlanUsage(),
    refreshConnection: refreshTokenPlanUsage,
    refreshInterval,
    setRefreshInterval,
    busy: computed(() => initializing.value || refreshing.value.size > 0),
  }
}
