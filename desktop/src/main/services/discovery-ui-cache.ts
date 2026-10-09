import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  readdir,
  lstat,
  utimes,
} from 'node:fs/promises'
import { join } from 'node:path'
import type { DiscoveryPageKey, DiscoveryUiEntry } from '../../shared/discovery-ui'
import {
  parseDiscoveryEntry,
  sameDiscoveryRelease,
  validDiscoveryPath,
} from './discovery-ui-manifest'

type Resource = DiscoveryUiEntry['resources'][number]
interface CachedResource {
  bytes: Buffer
  contentType: string
}
interface Options {
  directory: string
  loadEntry: (pageKey: DiscoveryPageKey, releaseId?: string) => Promise<unknown>
  fetch?: typeof globalThis.fetch
  now?: () => number
  maxCacheBytes?: number
}

/** Signed URLs stay in memory; disk cache identity is the verified SHA-256, independent of sign. */
export class DiscoveryUiCache {
  private readonly options: Options
  private readonly request: typeof globalThis.fetch
  private readonly now: () => number
  private readonly latest = new Map<DiscoveryPageKey, { entry: DiscoveryUiEntry; until: number }>()
  private readonly releases = new Map<string, DiscoveryUiEntry>()
  private readonly loading = new Map<string, Promise<DiscoveryUiEntry>>()
  private readonly downloading = new Map<string, Promise<CachedResource>>()
  private pruning: Promise<void> | null = null
  private pruneRequested = false
  private retainedRelease: string | undefined

  constructor(options: Options) {
    this.options = options
    this.request = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
  }

  async open(pageKey: DiscoveryPageKey, force = false): Promise<DiscoveryUiEntry> {
    const cached = this.latest.get(pageKey)
    if (!force && cached && cached.until > this.now()) return cached.entry
    const entry = await this.load(pageKey)
    this.latest.set(pageKey, { entry, until: this.now() + entry.refreshAfterSeconds * 1000 })
    return entry
  }

  retain(releaseId: string): void {
    this.retainedRelease = releaseId
  }

  async resource(releaseId: string, path: string): Promise<CachedResource> {
    if (!validDiscoveryPath(path)) throw new Error('Invalid discovery resource path')
    const entry = this.releases.get(releaseId)
    const asset = entry?.resources.find((candidate) => candidate.path === path)
    if (!entry || !asset) throw new Error('Unknown discovery resource')
    const pending = this.downloading.get(asset.sha256)
    if (pending) {
      const result = await pending
      if (result.bytes.length !== asset.size)
        throw new Error('Inconsistent discovery resource size')
      return { ...result, contentType: asset.contentType }
    }
    const operation = this.readOrDownload(entry, asset)
    this.downloading.set(asset.sha256, operation)
    try {
      return await operation
    } finally {
      this.downloading.delete(asset.sha256)
    }
  }

  private async load(pageKey: DiscoveryPageKey, releaseId?: string): Promise<DiscoveryUiEntry> {
    const key = pageKey + ':' + (releaseId ?? 'latest')
    const pending = this.loading.get(key)
    if (pending) return pending
    const operation = this.options.loadEntry(pageKey, releaseId).then((input) => {
      const entry = parseDiscoveryEntry(input, pageKey, this.now())
      if (releaseId && entry.releaseId !== releaseId)
        throw new Error('Pinned discovery release changed')
      const previous = this.releases.get(entry.releaseId)
      if (previous && !sameDiscoveryRelease(previous, entry))
        throw new Error('Immutable discovery release changed')
      this.releases.set(entry.releaseId, entry)
      const protectedReleases = new Set(
        [...this.latest.values()].map((item) => item.entry.releaseId),
      )
      protectedReleases.add(entry.releaseId)
      if (this.retainedRelease) protectedReleases.add(this.retainedRelease)
      for (const id of this.releases.keys()) {
        if (this.releases.size <= 16) break
        if (!protectedReleases.has(id)) this.releases.delete(id)
      }
      return entry
    })
    this.loading.set(key, operation)
    try {
      return await operation
    } finally {
      this.loading.delete(key)
    }
  }

  private async readOrDownload(
    initial: DiscoveryUiEntry,
    original: Resource,
  ): Promise<CachedResource> {
    const filename = join(this.options.directory, original.sha256 + '.bin')
    const cached = await this.readCached(filename, original)
    if (cached) return { bytes: cached, contentType: original.contentType }
    let entry = this.releases.get(initial.releaseId) ?? initial
    if (entry.expiresAt <= this.now() + 5000)
      entry = await this.load(initial.pageKey, initial.releaseId)
    for (let attempt = 0; attempt < 2; attempt++) {
      const asset = entry.resources.find((candidate) => candidate.path === original.path)!
      const response = await this.request(asset.url, {
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
      })
      if (response.status === 403 && attempt === 0) {
        await response.body?.cancel()
        entry = await this.load(initial.pageKey, initial.releaseId)
        continue
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        throw new Error(`Discovery resource download failed (HTTP ${response.status})`)
      }
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const part = await reader.read()
          if (part.done) break
          size += part.value.byteLength
          if (size > asset.size) throw new Error('Discovery resource exceeds its declared size')
          chunks.push(part.value)
        }
      } finally {
        await reader.cancel().catch(() => undefined)
      }
      const bytes = Buffer.concat(chunks, size)
      if (size !== asset.size || this.digest(bytes) !== asset.sha256)
        throw new Error('Discovery resource integrity check failed')
      await this.save(filename, bytes)
      return { bytes, contentType: asset.contentType }
    }
    throw new Error('Discovery resource authorization failed')
  }

  private async readCached(filename: string, asset: Resource): Promise<Buffer | null> {
    try {
      const stat = await lstat(filename)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== asset.size) return null
      const bytes = await readFile(filename)
      if (this.digest(bytes) !== asset.sha256) {
        await unlink(filename).catch(() => undefined)
        return null
      }
      const now = new Date(this.now())
      await utimes(filename, now, now).catch(() => undefined)
      return bytes
    } catch {
      return null
    }
  }

  private async save(filename: string, bytes: Buffer): Promise<void> {
    const temporary = filename + '.' + randomUUID() + '.tmp'
    try {
      await mkdir(this.options.directory, { recursive: true })
      await writeFile(temporary, bytes, { flag: 'wx' })
      await rename(temporary, filename)
      await this.prune()
    } catch {
      // Disk-full/read-only caches must not discard an otherwise verified online response.
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
  }

  private prune(): Promise<void> {
    this.pruneRequested = true
    if (this.pruning) return this.pruning
    this.pruning = (async () => {
      do {
        this.pruneRequested = false
        const names = await readdir(this.options.directory)
        const files = await Promise.all(
          names
            .filter((name) => /^[a-f0-9]{64}\.bin$/.test(name))
            .map(async (name) => {
              const path = join(this.options.directory, name)
              const info = await lstat(path).catch(() => null)
              return info?.isFile() ? { path, size: info.size, age: info.mtimeMs } : null
            }),
        )
        const ordered = files.filter((file) => file !== null).sort((a, b) => a.age - b.age)
        let size = ordered.reduce((sum, file) => sum + file.size, 0)
        while (
          ordered.length &&
          (size > (this.options.maxCacheBytes ?? 128 * 1024 * 1024) || ordered.length > 2048)
        ) {
          const oldest = ordered.shift()!
          await unlink(oldest.path).catch(() => undefined)
          size -= oldest.size
        }
      } while (this.pruneRequested)
    })().finally(() => {
      this.pruning = null
    })
    return this.pruning
  }

  private digest(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex')
  }
}
