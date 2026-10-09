export type BrowsingValue =
  null | boolean | number | string | BrowsingValue[] | { [key: string]: BrowsingValue }
export interface BrowsingPageSnapshot {
  state: { [key: string]: BrowsingValue }
  scroll: Record<string, { top: number; left: number }>
}
export type BrowsingSnapshot = Record<string, BrowsingPageSnapshot>

export const BROWSING_LIMITS = {
  pages: 64,
  pageBytes: 512 * 1024,
  totalBytes: 8 * 1024 * 1024,
} as const

export function validateBrowsingPage(key: unknown, value: unknown): BrowsingPageSnapshot {
  if (
    typeof key !== 'string' ||
    !/^[\w/:.?=&%-]{1,200}$/.test(key) ||
    ['__proto__', 'constructor', 'prototype'].includes(key)
  )
    throw new Error('Invalid page key')
  const visit = (item: unknown, depth: number): boolean => {
    if (depth > 16) return false
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return true
    if (typeof item === 'number') return Number.isFinite(item)
    if (Array.isArray(item))
      return item.length <= 10000 && item.every((child) => visit(child, depth + 1))
    if (!item || typeof item !== 'object' || Object.getPrototypeOf(item) !== Object.prototype)
      return false
    return Object.entries(item).every(
      ([name, child]) =>
        !['__proto__', 'constructor', 'prototype'].includes(name) && visit(child, depth + 1),
    )
  }
  if (!visit(value, 0)) throw new Error('Invalid page state')
  const page = value as BrowsingPageSnapshot
  if (
    !page.state ||
    Array.isArray(page.state) ||
    typeof page.state !== 'object' ||
    !page.scroll ||
    Array.isArray(page.scroll) ||
    typeof page.scroll !== 'object'
  )
    throw new Error('Invalid page snapshot')
  for (const position of Object.values(page.scroll)) {
    if (
      !position ||
      typeof position !== 'object' ||
      !Number.isFinite(position.top) ||
      !Number.isFinite(position.left) ||
      position.top < 0 ||
      position.left < 0
    )
      throw new Error('Invalid scroll position')
  }
  if (new TextEncoder().encode(JSON.stringify(page)).byteLength > BROWSING_LIMITS.pageBytes)
    throw new Error('Page snapshot too large')
  return structuredClone(page)
}

/** Keep renderer and main-process browsing snapshots under the same limits. */
export function createBoundedBrowsingState(initial: BrowsingSnapshot = {}) {
  const pages = new Map<string, { page: BrowsingPageSnapshot; bytes: number }>()
  const encoder = new TextEncoder()
  let entryBytes = 0

  function remove(key: string): void {
    const entry = pages.get(key)
    if (!entry) return
    entryBytes -= entry.bytes
    pages.delete(key)
  }

  function write(key: unknown, input: unknown): string[] {
    const page = validateBrowsingPage(key, input)
    const name = key as string
    const bytes = encoder.encode(`${JSON.stringify(name)}:${JSON.stringify(page)}`).byteLength
    remove(name)
    pages.set(name, { page, bytes })
    entryBytes += bytes

    const evicted: string[] = []
    const totalBytes = (): number => 2 + entryBytes + Math.max(0, pages.size - 1)
    while (pages.size > BROWSING_LIMITS.pages || totalBytes() > BROWSING_LIMITS.totalBytes) {
      const oldest = pages.keys().next().value!
      evicted.push(oldest)
      remove(oldest)
    }
    return evicted
  }

  for (const [key, page] of Object.entries(initial)) write(key, page)

  return {
    read(): BrowsingSnapshot {
      return structuredClone(
        Object.fromEntries(Array.from(pages, ([key, entry]) => [key, entry.page])),
      )
    },
    get(key: string): BrowsingPageSnapshot | undefined {
      const page = pages.get(key)?.page
      return page ? structuredClone(page) : undefined
    },
    write,
    delete: remove,
  }
}
