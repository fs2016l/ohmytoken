import type { Appearance, ThemeDefinition } from '../config/themes'

type Lab = { l: number; c: number; h: number }
function toOklch(hex: string): Lab {
  const linear = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const r = linear(1),
    g = linear(3),
    b = linear(5)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    c: Math.hypot(a, bb),
    h: (Math.atan2(bb, a) * 180) / Math.PI,
  }
}

function toLinearRgb({ l, c, h }: Lab): number[] {
  const a = c * Math.cos((h * Math.PI) / 180),
    b = c * Math.sin((h * Math.PI) / 180)
  const ll = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * ll - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * ll + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * ll - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function toHex(lab: Lab): string {
  const inGamut = (rgb: number[]): boolean =>
    rgb.every((value) => value >= -1e-7 && value <= 1.0000001)
  let rgb = toLinearRgb(lab)
  if (!inGamut(rgb)) {
    let low = 0,
      high = lab.c
    for (let i = 0; i < 22; i++) {
      const c = (low + high) / 2
      if (inGamut(toLinearRgb({ ...lab, c }))) low = c
      else high = c
    }
    rgb = toLinearRgb({ ...lab, c: low })
  }
  return (
    '#' +
    rgb
      .map((linear) => {
        const value = Math.max(0, Math.min(1, linear))
        const srgb = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
        return Math.round(srgb * 255)
          .toString(16)
          .padStart(2, '0')
      })
      .join('')
  )
}

/** Figma 1783:4231: continuous OKLCH interpolation, shortest hue arc, chroma gamut reduction. */
export function quotaPaint(percent: number, theme: ThemeDefinition, mode: Appearance): string {
  const p = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0))
  const ramp = theme.quotaRamp[mode]
  if (p % 25 === 0) return ramp[p / 25]!.toLowerCase()
  const index = Math.floor(p / 25)
  const start = toOklch(ramp[index]!),
    end = toOklch(ramp[index + 1]!)
  const t = (p % 25) / 25
  const hueDelta = ((end.h - start.h + 540) % 360) - 180
  return toHex({
    l: start.l + (end.l - start.l) * t,
    c: start.c + (end.c - start.c) * t,
    h: start.h + hueDelta * t,
  })
}

export function quotaLiquidSpec(mode: Appearance) {
  return { air: 0.025, back: mode === 'light' ? 0.12 : 0.08, front: mode === 'light' ? 0.55 : 0.29 }
}
