/** JSON settings with BOM, comments and trailing commas; quoted text is preserved. */
export function parseJsonConfig(text: string): unknown {
  let cleaned = ''
  let quoted = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      cleaned += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') {
      quoted = true
      cleaned += char
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      cleaned += '\n'
    } else if (char === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
      cleaned += ' '
    } else cleaned += char
  }
  let normalized = ''
  let comma = -1
  quoted = false
  escaped = false
  for (const char of cleaned) {
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') {
      quoted = true
      comma = -1
    } else if (char === ',') comma = normalized.length
    else if (!/\s/.test(char)) {
      if ((char === '}' || char === ']') && comma >= 0)
        normalized = normalized.slice(0, comma) + normalized.slice(comma + 1)
      comma = -1
    }
    normalized += char
  }
  return JSON.parse(normalized.replace(/^\uFEFF/, ''))
}
