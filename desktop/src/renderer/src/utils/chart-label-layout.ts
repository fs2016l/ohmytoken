interface ChartLabelCandidate {
  index: number
  value: number
  center: number
  width: number
}

/** Keep horizontal reading space even when neighboring labels sit at different heights. */
export function selectChartLabelIndices(
  candidates: ChartLabelCandidate[],
  chartWidth: number,
  gap: number,
): number[] {
  const selected: Array<{ index: number; left: number; right: number }> = []
  for (const candidate of [...candidates].sort((a, b) => b.value - a.value || a.index - b.index)) {
    if (candidate.width <= 0 || candidate.width > chartWidth) continue
    const half = candidate.width / 2
    const center = Math.max(half, Math.min(chartWidth - half, candidate.center))
    const left = center - half
    const right = center + half
    if (selected.every((other) => right + gap <= other.left || left >= other.right + gap))
      selected.push({ index: candidate.index, left, right })
  }
  return selected.map((item) => item.index).sort((a, b) => a - b)
}
