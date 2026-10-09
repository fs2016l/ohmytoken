/** Keep the newest activity for each participant, independent of row or insertion order. */
export function updateLatestActivity(
  activity: Map<string, number>,
  name: string,
  timestampMs: number,
): void {
  const time = Number.isFinite(timestampMs) ? Math.max(0, timestampMs) : 0
  activity.set(name, Math.max(activity.get(name) ?? 0, time))
}

/** Unknown times go last; equal times use names for a stable order. */
export function orderByLatestActivity(activity: ReadonlyMap<string, number>): string[] {
  return [...activity.keys()].sort(
    (a, b) => (activity.get(b) ?? 0) - (activity.get(a) ?? 0) || a.localeCompare(b),
  )
}
