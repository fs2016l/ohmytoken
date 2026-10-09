export interface NumberGlyph {
  previous: string
  current: string
  changed: boolean
}

/** Units, signs and digit-count changes replace the formatted value as a whole. */
export function numberTransitionGlyphs(previous: string, current: string): NumberGlyph[] | null {
  if (previous === current || previous.replace(/\d/g, '#') !== current.replace(/\d/g, '#'))
    return null
  const before = [...previous]
  return [...current].map((character, index) => ({
    previous: before[index],
    current: character,
    changed: before[index] !== character,
  }))
}
