/** A bounded, weighted median-cut palette for our flat chart graphics.
 * Kept in the application so GIF export does not bundle gifenc's upstream PnnQuant port.
 */
export function replayPalette(rgba: Uint8ClampedArray, limit: number): number[][] {
  type Color = { rgb: number[]; count: number }
  const histogram = new Map<number, Color>()
  const stride = Math.max(1, Math.ceil(rgba.length / 4 / 65536)) * 4
  for (let at = 0; at < rgba.length; at += stride) {
    const r = rgba[at],
      g = rgba[at + 1],
      b = rgba[at + 2]
    const key = ((r >>> 3) << 10) | ((g >>> 3) << 5) | (b >>> 3)
    const bin = histogram.get(key)
    if (bin) {
      bin.count++
      bin.rgb[0] += r
      bin.rgb[1] += g
      bin.rgb[2] += b
    } else histogram.set(key, { rgb: [r, g, b], count: 1 })
  }
  const colors = [...histogram.values()].map((color) => ({
    rgb: color.rgb.map((value) => value / color.count),
    count: color.count,
  }))
  if (!colors.length) return [[0, 0, 0]]
  function group(entries: Color[]) {
    const ranges = [0, 1, 2].map((channel) => {
      let low = 255,
        high = 0
      for (const entry of entries) {
        low = Math.min(low, entry.rgb[channel])
        high = Math.max(high, entry.rgb[channel])
      }
      return high - low
    })
    const axis = ranges.indexOf(Math.max(...ranges)),
      count = entries.reduce((sum, entry) => sum + entry.count, 0)
    return {
      entries,
      axis,
      count,
      score: entries.length > 1 ? ranges[axis] ** 2 * Math.sqrt(count) : 0,
    }
  }
  const groups = [group(colors)]
  while (groups.length < limit) {
    let chosen = 0
    for (let i = 1; i < groups.length; i++) if (groups[i].score > groups[chosen].score) chosen = i
    const current = groups[chosen]
    if (!current.score) break
    const sorted = current.entries.sort((a, b) => a.rgb[current.axis] - b.rgb[current.axis])
    let weight = 0,
      split = 1
    for (; split < sorted.length; split++) {
      weight += sorted[split - 1].count
      if (weight >= current.count / 2) break
    }
    split = Math.min(split, sorted.length - 1)
    groups.splice(chosen, 1, group(sorted.slice(0, split)), group(sorted.slice(split)))
  }
  return groups.map(({ entries, count }) =>
    [0, 1, 2].map((channel) =>
      Math.round(entries.reduce((sum, entry) => sum + entry.rgb[channel] * entry.count, 0) / count),
    ),
  )
}
