import { watch } from 'vue'
import type { RouteLocationResolved, Router } from 'vue-router'
import { navigationGroups } from '../config/navigation'
import { usePageState } from './usePageState'

const roots = navigationGroups.flatMap((group) => group.items.map((item) => item.to))
const belongsTo = (root: string, path: string): boolean =>
  path === root || path.startsWith(root + '/')
const knownRoute = (route: Pick<RouteLocationResolved, 'matched'>): boolean =>
  route.matched.length > 0 && !route.matched.some((record) => record.path.includes(':pathMatch'))

/** Sidebar entries resume each module; explicit in-page navigation keeps its own target. */
export function useWorkspaceNavigation(router: Router) {
  const state = usePageState('workspace-navigation', {
    destinations: {} as Record<string, string>,
  })
  watch(
    router.currentRoute,
    (route) => {
      const root = roots.find((item) => belongsTo(item, route.path))
      if (root && knownRoute(route)) state.destinations[root] = route.fullPath
    },
    { immediate: true, flush: 'sync' },
  )
  function destination(root: string): string {
    const saved = state.destinations[root]
    if (typeof saved !== 'string' || !saved.startsWith('/')) return root
    const resolved = router.resolve(saved)
    return belongsTo(root, resolved.path) && knownRoute(resolved) ? saved : root
  }
  return { destination }
}
