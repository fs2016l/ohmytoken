const PERIOD = 100
const SEGMENTS = 32
const TAU = Math.PI * 2

/** Two identical periods let compositor translations loop without a visible seam. */
function waveSurface(
  amplitude: number,
  scale: number,
  phase: number,
  harmonic: number,
  levelOffset = 0,
): string {
  const offset = amplitude * (1 + levelOffset)
  const strength = (amplitude * scale) / (1 + harmonic)
  const point = (x: number) => {
    const angle = (x / PERIOD) * TAU
    return {
      x,
      y:
        offset +
        strength * (Math.sin(angle + phase) + harmonic * Math.sin(2 * angle - phase * 0.63)),
      slope:
        ((strength * TAU) / PERIOD) *
        (Math.cos(angle + phase) + 2 * harmonic * Math.cos(2 * angle - phase * 0.63)),
    }
  }
  const coordinate = (x: number, y: number) => `${x.toFixed(3)},${y.toFixed(3)}`
  let previous = point(0)
  let path = `M${coordinate(previous.x, previous.y)}`
  for (let step = 1; step <= SEGMENTS; step++) {
    const next = point((step * PERIOD * 2) / SEGMENTS)
    const third = (next.x - previous.x) / 3
    path += `C${coordinate(previous.x + third, previous.y + previous.slope * third)} ${coordinate(next.x - third, next.y - next.slope * third)} ${coordinate(next.x, next.y)}`
    previous = next
  }
  return path
}

/** Keep the mean front surface at the real level, including nearly empty/full tiles. */
export function quotaLiquidGeometry(percent: number, height: number) {
  const h = Number.isFinite(height) && height > 0 ? height : 124
  const p = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0))
  const depth = (h * p) / 100
  const amplitude = Math.min((8.5 * h) / 124, Math.min(depth, h - depth) * 0.66)
  const svgHeight = h + amplitude * 2
  const front = waveSurface(amplitude, 1, 0, 0.18)
  const fill = (path: string) => `${path}V${svgHeight.toFixed(3)}H0Z`
  return {
    amplitude,
    depth,
    viewBox: `0 0 ${PERIOD * 2} ${svgHeight}`,
    back: fill(waveSurface(amplitude, 0.66, 1.9, 0.1, -0.22)),
    middle: fill(waveSurface(amplitude, 0.78, 2.4, 0.14)),
    front: fill(front),
    surface: front,
  }
}
