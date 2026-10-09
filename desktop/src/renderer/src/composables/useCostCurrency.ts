import { computed, readonly, ref } from 'vue'
import type { CostCurrency } from '@shared/usage-cost'
import type { ExchangeRateState } from '@shared/cost-currency'
import {
  CLOUD_REFERENCE_CHECK_INTERVAL_MS,
  CLOUD_REFERENCE_RETRY_INTERVAL_MS,
} from '@shared/cloud-reference-sync'

const STORAGE_KEY = 'cost-currency'
const currency = ref<CostCurrency>('USD')
const exchange = ref<ExchangeRateState>({ snapshot: null, refreshFailed: false })
const loading = ref(false)
let initialized = false
let pending: Promise<void> | undefined
let pendingForced = false
let queuedForce: Promise<void> | undefined
let retryTimer: number | undefined
const preferenceChannel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('ohmyagent-preferences')

preferenceChannel?.addEventListener(
  'message',
  (event: MessageEvent<{ type?: string; value?: unknown }>) => {
    if (
      event.data?.type === 'currency' &&
      (event.data.value === 'CNY' || event.data.value === 'USD')
    )
      currency.value = event.data.value
  },
)

function setCurrency(value: CostCurrency): void {
  currency.value = value === 'CNY' ? 'CNY' : 'USD'
  try {
    localStorage.setItem(STORAGE_KEY, currency.value)
  } catch {
    /* 偏好无法保存时仍可在本次使用。 */
  }
  preferenceChannel?.postMessage({ type: 'currency', value: currency.value })
}

function refreshRates(force = false): Promise<void> {
  if (pending) {
    if (!force || pendingForced) return pending
    queuedForce ??= pending
      .then(() => refreshRates(true))
      .finally(() => {
        queuedForce = undefined
      })
    return queuedForce
  }
  loading.value = true
  pendingForced = force
  pending = window.api
    .getExchangeRates(force)
    .then((result) => {
      exchange.value = result
    })
    .catch(() => {
      exchange.value = { ...exchange.value, refreshFailed: true }
    })
    .finally(() => {
      loading.value = false
      pendingForced = false
      pending = undefined
      if (retryTimer) window.clearTimeout(retryTimer)
      retryTimer = exchange.value.refreshFailed
        ? window.setTimeout(() => {
            retryTimer = undefined
            if (!document.hidden) void refreshRates()
          }, CLOUD_REFERENCE_RETRY_INTERVAL_MS)
        : undefined
    })
  return pending
}

export function useCostCurrency() {
  if (!initialized) {
    initialized = true
    try {
      currency.value = localStorage.getItem(STORAGE_KEY) === 'CNY' ? 'CNY' : 'USD'
    } catch {
      /* 使用默认币种。 */
    }
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY) currency.value = event.newValue === 'CNY' ? 'CNY' : 'USD'
    })
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void refreshRates()
    })
    window.setInterval(() => {
      if (!document.hidden) void refreshRates()
    }, CLOUD_REFERENCE_CHECK_INTERVAL_MS)
    void refreshRates()
  }
  return {
    currency: computed({ get: () => currency.value, set: setCurrency }),
    exchange: readonly(exchange),
    exchangeLoading: readonly(loading),
    refreshRates,
  }
}
