import { computed, type Ref } from 'vue'
import type { NetworkCheckSnapshot } from '@shared/network-check'
import { useNetworkLabels } from './useNetworkLabels'
import { networkRiskSources, networkSourceName } from '../utils/network-display'
export function useNetworkReport(snapshot: Readonly<Ref<NetworkCheckSnapshot | null>>) {
  const { label, typeText, countryText } = useNetworkLabels()
  const sources = computed(() => snapshot.value?.sources ?? [])
  const quality = computed(() =>
    sources.value.find((source) => source.state === 'done' && source.country),
  )
  const location = computed(
    () =>
      [
        quality.value?.countryCode
          ? countryText(quality.value.countryCode)
          : quality.value?.country,
        quality.value?.city,
      ]
        .filter(Boolean)
        .join(' · ') || label('Location unavailable', '暂无地区信息'),
  )
  const risk = computed(() => networkRiskSources(sources.value))
  const types = computed(() =>
    sources.value.filter((source) => source.usageType || source.companyType),
  )
  const type = computed(() => {
    const values = [...new Set(types.value.map((source) => source.usageType ?? source.companyType))]
    return values.length > 1 ? label('Sources differ', '来源不一致') : typeText(values[0])
  })
  const typeSources = computed(
    () =>
      types.value.map((source) => networkSourceName(source.id)).join(' / ') ||
      label('No type returned', '来源未提供类型'),
  )
  return { sources, quality, location, risk, type, typeSources }
}
