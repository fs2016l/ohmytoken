import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePageState } from './usePageState'
import { presetRange } from '../utils/date-range'
import { validDate } from '../utils/analytics-trend'
import type { UsageAnalyticsFilter } from '@shared/analytics'

/** Capture a detail destination's own context; other cached routes cannot mutate it. */
export function useAnalyticsContext(pageKey: string) {
  const route = useRoute(),
    router = useRouter(),
    path = route.path
  const state = usePageState(pageKey, {
    range: presetRange('month'),
    agents: [] as string[],
    models: [] as string[],
    projects: [] as string[],
    query: '',
    back: '/analytics',
  })
  watch(
    () => route.fullPath,
    () => {
      if (route.path !== path) return
      const { from, to, back, agents, models, projects, search } = route.query
      if (
        typeof from === 'string' &&
        typeof to === 'string' &&
        ((!from && !to) || (validDate(from) && validDate(to) && from <= to))
      )
        state.range = { from, to, preset: from ? 'custom' : 'all' }
      if (back === '/agent' || back === '/analytics') state.back = back
      const list = (value: unknown): string[] =>
        (Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 256)
      if (agents !== undefined) state.agents = list(agents)
      if (models !== undefined) state.models = list(models)
      if (projects !== undefined) state.projects = list(projects)
      if (typeof search === 'string') state.query = search
    },
    { immediate: true },
  )
  const filter = computed<UsageAnalyticsFilter>(() => ({
    from: state.range.from || undefined,
    to: state.range.to || undefined,
    agents: [...state.agents],
    models: [...state.models],
    projectIds: [...state.projects],
    query: state.query,
  }))
  return { state, filter, back: () => router.push(state.back) }
}
