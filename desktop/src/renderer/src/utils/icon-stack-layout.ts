import { getAgentName } from '../config/agents'
import { modelIconIdentity } from '../config/brand-logos'

export interface IconGroup {
  icon: string
  names: string[]
}

export function iconGroups(items: string[], kind: 'agents' | 'models'): IconGroup[] {
  const groups = new Map<string, IconGroup>()
  for (const item of new Set(items.filter(Boolean))) {
    const identity = kind === 'agents' ? item : modelIconIdentity(item)
    const name = kind === 'agents' ? getAgentName(item) : item
    const group = groups.get(identity)
    if (group) group.names.push(name)
    else groups.set(identity, { icon: item, names: [name] })
  }
  return [...groups.values()]
}

/** Keep a readable edge of each overlapping icon, then put the rest in the hover grid. */
export function iconStackLayout(count: number, size: number, max: number, maxWidth?: number) {
  const cardSize = size + 2
  const flatStep = cardSize + 4
  const bounded = maxWidth !== undefined && Number.isFinite(maxWidth)
  const width = Math.max(cardSize, maxWidth ?? cardSize)
  const minStep = Math.max(7, Math.floor(size / 2))
  const visibleCount = Math.max(
    0,
    Math.min(count, max, bounded ? Math.floor((width - cardSize) / minStep) + 1 : max),
  )
  const gaps = Math.max(0, visibleCount - 1)
  const fitsFlat = cardSize + gaps * flatStep <= width
  const restStep = bounded
    ? gaps
      ? fitsFlat
        ? flatStep
        : Math.min(Math.max(minStep, size - 3), (width - cardSize) / gaps)
      : flatStep
    : Math.max(7, size - 5)
  const openStep = bounded ? restStep : cardSize + 2
  return {
    cardSize,
    visibleCount,
    restStep,
    openStep,
    restWidth: cardSize + gaps * restStep,
    openWidth: cardSize + gaps * openStep,
    overlapping: gaps > 0 && restStep < cardSize,
    bounded,
  }
}
