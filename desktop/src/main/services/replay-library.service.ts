import { randomUUID } from 'node:crypto'
import { promises as fs, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ReplayRecord, ReplayStorageInfo } from '../../shared/replay'
import { ReplayStore } from './replay-storage.service'

interface SavedReplayStorage {
  historyDirectories?: string[]
}

export interface ReplayLibraryOptions {
  defaultDirectory: string
  installDirectory: string
  settingsFile: string
  defaultReason: ReplayStorageInfo['defaultReason']
}

function pathKey(directory: string): string {
  const normalized = resolve(directory)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function within(directory: string, parent: string): boolean {
  const difference = relative(parent, directory)
  return (
    difference === '' ||
    (difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference))
  )
}

function validDirectory(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length < (process.platform === 'win32' ? 900 : 4096) &&
    !/[\r\n]/.test(value) &&
    isAbsolute(value)
  )
}

/** Keeps previous history readable without moving or copying its media files. */
export class ReplayLibrary {
  private readonly options: ReplayLibraryOptions
  private readonly stores = new Map<string, ReplayStore>()
  private readonly recordStores = new Map<string, ReplayStore>()
  private selectedDirectory: string | null = null
  private historyDirectories: string[] = []

  constructor(options: ReplayLibraryOptions) {
    this.options = options
    try {
      const bytes = readFileSync(options.settingsFile)
      if (bytes.length > 128 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xfe) return
      const raw = bytes.toString('utf16le', 2)
      // The first line is plain text so the Windows uninstaller can protect this path.
      const divider = raw.indexOf('\n')
      if (divider < 0) return
      const selected = raw.slice(0, divider).replace(/\r$/, '')
      const saved = JSON.parse(raw.slice(divider + 1)) as SavedReplayStorage
      if (validDirectory(selected)) this.selectedDirectory = resolve(selected)
      if (Array.isArray(saved.historyDirectories))
        this.historyDirectories = saved.historyDirectories
          .filter(validDirectory)
          .map((directory) => resolve(directory))
    } catch {
      // A missing or invalid preference leaves existing replay files untouched.
    }
  }

  get directory(): string {
    return this.selectedDirectory ?? this.options.defaultDirectory
  }

  info(): ReplayStorageInfo {
    return {
      directory: this.directory,
      selectedDirectory: this.selectedDirectory,
      defaultDirectory: this.options.defaultDirectory,
      defaultReason: this.options.defaultReason,
    }
  }

  private store(directory: string): ReplayStore {
    const key = pathKey(directory)
    let store = this.stores.get(key)
    if (!store) {
      store = new ReplayStore(directory)
      this.stores.set(key, store)
    }
    return store
  }

  currentStore(): ReplayStore {
    return this.store(this.directory)
  }

  private directories(): string[] {
    const seen = new Set<string>()
    return [this.directory, this.options.defaultDirectory, ...this.historyDirectories].filter(
      (directory) => {
        const key = pathKey(directory)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      },
    )
  }

  async list(): Promise<ReplayRecord[]> {
    const records: ReplayRecord[] = []
    this.recordStores.clear()
    for (const directory of this.directories()) {
      const current = pathKey(directory) === pathKey(this.directory)
      if (!current) {
        try {
          if (!(await fs.stat(directory)).isDirectory()) continue
        } catch {
          continue
        }
      }
      const store = this.store(directory)
      try {
        for (const record of await store.list()) {
          if (this.recordStores.has(record.id)) continue
          this.recordStores.set(record.id, store)
          records.push(record)
        }
      } catch (error) {
        if (current) throw error
      }
    }
    return records.sort((a, b) => b.createdAt - a.createdAt)
  }

  async storeFor(id: string): Promise<ReplayStore> {
    if (!this.recordStores.has(id)) await this.list()
    const store = this.recordStores.get(id)
    if (!store) throw new Error('missing-media')
    return store
  }

  private async validateSelection(directory: string): Promise<string> {
    if (!validDirectory(directory)) throw new Error('invalid-replay-directory')
    const selected = await fs.realpath(directory)
    if (!(await fs.stat(selected)).isDirectory()) throw new Error('invalid-replay-directory')
    const install = await fs.realpath(this.options.installDirectory)
    if (within(selected, install)) throw new Error('replay-directory-inside-installation')
    const probe = join(selected, `.ohmytoken-write-${randomUUID()}`)
    try {
      await fs.writeFile(probe, '', { flag: 'wx', mode: 0o600 })
    } finally {
      await fs.unlink(probe).catch(() => {})
    }
    return selected
  }

  async select(directory: string | null): Promise<ReplayStorageInfo> {
    const next = directory === null ? null : await this.validateSelection(directory)
    const previous = this.directory
    const target = next ?? this.options.defaultDirectory
    if (pathKey(previous) === pathKey(target)) {
      if (this.selectedDirectory === next) return this.info()
    }
    const seen = new Set([pathKey(target)])
    const historyDirectories = [previous, ...this.historyDirectories].filter((item) => {
      const key = pathKey(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const saved: SavedReplayStorage = { historyDirectories }
    const temporary = `${this.options.settingsFile}.${randomUUID()}.tmp`
    await fs.mkdir(dirname(this.options.settingsFile), { recursive: true })
    try {
      const content = `${next ?? ''}\r\n${JSON.stringify(saved)}`
      await fs.writeFile(
        temporary,
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, 'utf16le')]),
        { mode: 0o600 },
      )
      await fs.rename(temporary, this.options.settingsFile)
    } finally {
      await fs.unlink(temporary).catch(() => {})
    }
    this.selectedDirectory = next
    this.historyDirectories = historyDirectories
    this.recordStores.clear()
    return this.info()
  }
}
