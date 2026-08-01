import { computed, reactive, ref } from 'vue'
import {
  TOKEN_PLAN_PROVIDER_IDS,
  type TokenPlanCredentialStatus,
  type TokenPlanProviderId,
  type TokenPlanUsageSnapshot,
} from '../../../shared/token-plan'

type ProviderBooleanMap = Record<TokenPlanProviderId, boolean>
type ProviderErrorMap = Record<TokenPlanProviderId, 'save' | 'remove' | 'query' | 'restart' | null>
type SnapshotMap = Record<TokenPlanProviderId, TokenPlanUsageSnapshot | null>

function booleanMap(): ProviderBooleanMap {
  return Object.fromEntries(TOKEN_PLAN_PROVIDER_IDS.map((id) => [id, false])) as ProviderBooleanMap
}

function errorMap(): ProviderErrorMap {
  return Object.fromEntries(TOKEN_PLAN_PROVIDER_IDS.map((id) => [id, null])) as ProviderErrorMap
}

function snapshotMap(): SnapshotMap {
  return Object.fromEntries(TOKEN_PLAN_PROVIDER_IDS.map((id) => [id, null])) as SnapshotMap
}

const credentials = ref<TokenPlanCredentialStatus[]>([])
const snapshots = reactive<SnapshotMap>(snapshotMap())
const refreshing = reactive<ProviderBooleanMap>(booleanMap())
const saving = reactive<ProviderBooleanMap>(booleanMap())
const removing = reactive<ProviderBooleanMap>(booleanMap())
const actionErrors = reactive<ProviderErrorMap>(errorMap())
const initializing = ref(false)
const refreshingAll = ref(false)
const loadFailed = ref(false)
let initialized = false

function upsertCredential(status: TokenPlanCredentialStatus): void {
  const index = credentials.value.findIndex((item) => item.providerId === status.providerId)
  if (index >= 0) credentials.value.splice(index, 1, status)
  else credentials.value.push(status)
}

function credentialFor(providerId: TokenPlanProviderId): TokenPlanCredentialStatus {
  return (
    credentials.value.find((item) => item.providerId === providerId) ?? {
      providerId,
      configured: false,
      updatedAt: null,
    }
  )
}

async function refreshProvider(providerId: TokenPlanProviderId): Promise<void> {
  if (!credentialFor(providerId).configured) return
  refreshing[providerId] = true
  actionErrors[providerId] = null
  try {
    snapshots[providerId] = await window.api.tokenPlanUsageQuery(providerId)
  } catch {
    actionErrors[providerId] = 'query'
  } finally {
    refreshing[providerId] = false
  }
}

async function refreshAllProviders(): Promise<void> {
  const configured = TOKEN_PLAN_PROVIDER_IDS.filter((id) => credentialFor(id).configured)
  if (configured.length === 0) return

  refreshingAll.value = true
  configured.forEach((id) => {
    refreshing[id] = true
    actionErrors[id] = null
  })
  try {
    const results = await window.api.tokenPlanUsageQueryAll()
    results.forEach((snapshot) => {
      snapshots[snapshot.providerId] = snapshot
    })
  } catch {
    configured.forEach((id) => {
      actionErrors[id] = 'query'
    })
  } finally {
    configured.forEach((id) => {
      refreshing[id] = false
    })
    refreshingAll.value = false
  }
}

async function saveCredential(providerId: TokenPlanProviderId, apiKey: string): Promise<boolean> {
  if (!apiKey.trim()) return false
  if (
    typeof window.api.tokenPlanCredentialSave !== 'function' ||
    typeof window.api.tokenPlanUsageQuery !== 'function'
  ) {
    actionErrors[providerId] = 'restart'
    return false
  }

  saving[providerId] = true
  actionErrors[providerId] = null
  try {
    const status = await window.api.tokenPlanCredentialSave({ providerId, apiKey })
    upsertCredential(status)
    await refreshProvider(providerId)
    return true
  } catch {
    actionErrors[providerId] = 'save'
    return false
  } finally {
    saving[providerId] = false
  }
}

async function removeCredential(providerId: TokenPlanProviderId): Promise<boolean> {
  removing[providerId] = true
  actionErrors[providerId] = null
  try {
    const removed = await window.api.tokenPlanCredentialRemove(providerId)
    if (!removed) throw new Error('remove-failed')
    upsertCredential({
      providerId,
      configured: false,
      updatedAt: null,
    })
    snapshots[providerId] = null
    return true
  } catch {
    actionErrors[providerId] = 'remove'
    return false
  } finally {
    removing[providerId] = false
  }
}

async function initialize(): Promise<void> {
  if (initialized || initializing.value) return
  initializing.value = true
  loadFailed.value = false
  try {
    credentials.value = await window.api.tokenPlanCredentialsList()
    initialized = true
    await refreshAllProviders()
  } catch {
    loadFailed.value = true
  } finally {
    initializing.value = false
  }
}

const configuredCount = computed(
  () => credentials.value.filter((credential) => credential.configured).length,
)

export function useTokenPlanUsage() {
  return {
    credentials,
    snapshots,
    refreshing,
    saving,
    removing,
    actionErrors,
    initializing,
    refreshingAll,
    loadFailed,
    configuredCount,
    credentialFor,
    initialize,
    refreshProvider,
    refreshAllProviders,
    saveCredential,
    removeCredential,
  }
}
