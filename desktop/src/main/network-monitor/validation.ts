export function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32)
}
