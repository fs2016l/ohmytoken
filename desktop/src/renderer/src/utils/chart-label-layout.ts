export interface ChartRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ChartLabelCandidate {
  index: number
  value: number
  bar: ChartRect
  width: number
  height: number
}

export interface ChartLabelPlacement {
  index: number
  /** Center and bottom of the text, in chart coordinates. */
  x: number
  y: number
}

function intersects(a: ChartRect, b: ChartRect, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  )
}

/** Keep labels above their own columns, using both dimensions and every painted bar. */
export function layoutChartLabels(
  candidates: ChartLabelCandidate[],
  bounds: ChartRect,
): ChartLabelPlacement[] {
  const selected: Array<{ placement: ChartLabelPlacement; rect: ChartRect }> = []
  const bars = candidates.map((candidate) => candidate.bar)
  for (const candidate of [...candidates].sort((a, b) => b.value - a.value || a.index - b.index)) {
    if (
      candidate.value <= 0 ||
      candidate.width <= 0 ||
      candidate.height <= 0 ||
      candidate.width > bounds.width
    )
      continue
    const half = candidate.width / 2
    const center = Math.max(
      bounds.x + half,
      Math.min(bounds.x + bounds.width - half, candidate.bar.x + candidate.bar.width / 2),
    )
    const y = candidate.bar.y - 4
    if (y - candidate.height < bounds.y || y > bounds.y + bounds.height) continue
    const obstacles = [
      ...bars.map((rect) => ({ rect, gap: 2 })),
      ...selected.map((item) => ({ rect: item.rect, gap: 3 })),
    ].filter(
      ({ rect, gap }) => y - candidate.height < rect.y + rect.height + gap && y + gap > rect.y,
    )
    // A small horizontal adjustment may clear a taller neighbor. Keep the center over
    // its own column so the value never appears to belong to a different date.
    const minX = Math.max(bounds.x + half, Math.min(center, candidate.bar.x))
    const maxX = Math.min(
      bounds.x + bounds.width - half,
      Math.max(center, candidate.bar.x + candidate.bar.width),
    )
    const positions = [
      center,
      ...obstacles.flatMap(({ rect, gap }) => [
        rect.x - gap - half,
        rect.x + rect.width + gap + half,
      ]),
    ]
      .filter((x) => x >= minX && x <= maxX)
      .sort((a, b) => Math.abs(a - center) - Math.abs(b - center))
    const x = positions.find((x) =>
      obstacles.every(
        ({ rect, gap }) =>
          !intersects(
            {
              x: x - half,
              y: y - candidate.height,
              width: candidate.width,
              height: candidate.height,
            },
            rect,
            gap,
          ),
      ),
    )
    if (x === undefined) continue
    const textRect = {
      x: x - half,
      y: y - candidate.height,
      width: candidate.width,
      height: candidate.height,
    }
    selected.push({ placement: { index: candidate.index, x, y }, rect: textRect })
  }
  return selected.map((item) => item.placement).sort((a, b) => a.index - b.index)
}
