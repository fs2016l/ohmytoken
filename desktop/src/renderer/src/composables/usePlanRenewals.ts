import { onMounted, ref } from 'vue'
import type { PlanRenewal, PlanRenewalInput } from '../../../shared/plan-renewals'
import { useI18n } from '../i18n/useI18n'

export function usePlanRenewals() {
  const { label } = useI18n()
  const items = ref<PlanRenewal[]>([])
  const loading = ref(true),
    busy = ref(false),
    error = ref('')
  async function load(): Promise<void> {
    if (busy.value) return
    loading.value = true
    error.value = ''
    try {
      items.value = await window.api.planRenewalsList()
    } catch {
      error.value = label(
        'Could not load renewal records. Please retry.',
        '续费记录加载失败，请重试。',
      )
    } finally {
      loading.value = false
    }
  }
  async function mutate(action: () => Promise<PlanRenewal[]>): Promise<boolean> {
    if (busy.value || loading.value) return false
    busy.value = true
    error.value = ''
    try {
      items.value = await action()
      return true
    } catch {
      error.value = label(
        'Could not save the change. Your existing records have been kept. Please retry.',
        '修改未能保存，原有记录已保留，请重试。',
      )
      return false
    } finally {
      busy.value = false
    }
  }
  onMounted(load)
  return {
    items,
    loading,
    busy,
    error,
    load,
    save: (input: PlanRenewalInput) => mutate(() => window.api.planRenewalsSave(input)),
    remove: (id: string) => mutate(() => window.api.planRenewalsDelete(id)),
    // Vue ref arrays are proxies; Electron's context bridge requires a plain array.
    reorder: (ids: string[]) => mutate(() => window.api.planRenewalsReorder([...ids])),
    complete: (item: PlanRenewal) =>
      mutate(() => window.api.planRenewalsComplete(item.id, item.renewOn)),
  }
}
