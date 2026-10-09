/** Shared motion contract: Figma 306:1844, M01 343:2244, Selection 2157:39865. */
export const motion = {
  page: 180,
  popover: 160,
  hover: 150,
  reorder: 240,
  transfer: 360,
  number: 560,
  numberText: {
    digits: 320,
    fade: 180,
    largeFont: 24,
    easing: 'cubic-bezier(0.22, 0.75, 0.2, 1)',
  },
  identity: 500,
  textRoll: {
    duration: 420,
    angle: 55,
    perspective: 240,
    easing: 'cubic-bezier(0.22, 0.68, 0.16, 1)',
  },
  detail: 300,
  selection: 600,
  discovery: 600,
  stagger: 80,
  wave: 12000,
  copyFeedback: 3200,
  ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
  entranceEase: 'cubic-bezier(0.18, 0.76, 0.22, 1)',
  selectionSpring: { mass: 1, stiffness: 240, damping: 24.8 },
} as const

/** Both chart entrances and in-place updates follow the same counter rhythm. */
export function chartMotion(reduced: boolean) {
  return {
    animation: !reduced,
    animationDuration: motion.number,
    animationDurationUpdate: motion.number,
    animationEasing: numberProgress,
    animationEasingUpdate: numberProgress,
  }
}

/** Solve the same cubic-bezier used by CSS so all number changes have one rhythm. */
export function numberProgress(progress: number): number {
  if (progress <= 0) return 0
  if (progress >= 1) return 1
  const curve = (t: number, a: number, b: number): number =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3
  let low = 0
  let high = 1
  for (let i = 0; i < 16; i++) {
    const middle = (low + high) / 2
    if (curve(middle, 0.4, 0.2) < progress) low = middle
    else high = middle
  }
  return curve((low + high) / 2, 0, 1)
}

/** Analytical damped spring, not a bezier approximation; Figma physical parameters. */
export function selectionProgress(progress: number): number {
  if (progress <= 0) return 0
  if (progress >= 1) return 1
  const { mass, stiffness, damping } = motion.selectionSpring
  const decay = damping / (2 * mass)
  const frequency = Math.sqrt(stiffness / mass - decay ** 2)
  const time = (progress * motion.selection) / 1000
  return (
    1 -
    Math.exp(-decay * time) *
      (Math.cos(frequency * time) + (decay / frequency) * Math.sin(frequency * time))
  )
}
