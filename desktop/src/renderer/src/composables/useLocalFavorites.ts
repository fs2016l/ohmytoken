import { computed, onMounted, readonly, ref, shallowRef } from 'vue'
import {
  localFavoriteKey,
  type LocalFavorite,
  type LocalFavoriteImport,
  type LocalFavoriteTarget,
  type LocalFavoriteType,
  type LocalFavoritesState,
} from '@shared/local-favorites'

const items = shallowRef<LocalFavorite[]>([])
const ready = ref(false)
const error = ref('')
const pending = ref(new Set<string>())
let revision = -1
let initialization: Promise<void> | undefined
let subscribed = false

function apply(state: LocalFavoritesState): void {
  if (state.revision < revision) return
  revision = state.revision
  items.value = state.items
}
function legacyFavorites(): LocalFavoriteImport[] {
  try {
    const raw = localStorage.getItem('floating-session-preferences')
    if (!raw || raw.length > 8 * 1024 * 1024) return []
    const value = JSON.parse(raw)
    if (!Array.isArray(value.pinned)) return []
    return value.pinned
      .slice(0, 10_000)
      .map(
        (item: {
          agent: string
          rootSessionId: string
          snapshot?: LocalFavoriteImport['snapshot']
        }) => ({
          target: { type: 'session' as const, agent: item?.agent, id: item?.rootSessionId },
          snapshot: item?.snapshot,
        }),
      )
  } catch {
    return []
  }
}
function initialize(): Promise<void> {
  if (ready.value) return Promise.resolve()
  if (initialization) return initialization
  if (!subscribed) {
    window.api.onLocalFavoritesChanged(apply)
    subscribed = true
  }
  initialization = (async () => {
    apply(await window.api.localFavoritesMigrate(legacyFavorites()))
    ready.value = true
    error.value = ''
  })().finally(() => {
    initialization = undefined
  })
  return initialization
}
async function set(target: LocalFavoriteTarget, favorite: boolean): Promise<boolean> {
  const key = localFavoriteKey(target)
  if (pending.value.has(key)) return false
  pending.value = new Set([...pending.value, key])
  try {
    await initialize()
    apply(await window.api.localFavoriteSet(target, favorite))
    error.value = ''
    return true
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
    return false
  } finally {
    const next = new Set(pending.value)
    next.delete(key)
    pending.value = next
  }
}
async function reorder(type: LocalFavoriteType, order: LocalFavoriteTarget[]): Promise<boolean> {
  try {
    await initialize()
    apply(await window.api.localFavoritesReorder(type, order))
    error.value = ''
    return true
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
    return false
  }
}

export function useLocalFavorites() {
  const keys = computed(() => new Set(items.value.map(localFavoriteKey)))
  const contains = (target: LocalFavoriteTarget): boolean =>
    keys.value.has(localFavoriteKey(target))
  onMounted(() => {
    void initialize().catch((reason) => {
      error.value = reason instanceof Error ? reason.message : String(reason)
    })
  })
  return {
    items: readonly(items),
    ready: readonly(ready),
    error: readonly(error),
    pending: readonly(pending),
    contains,
    set,
    reorder,
    initialize,
  }
}
