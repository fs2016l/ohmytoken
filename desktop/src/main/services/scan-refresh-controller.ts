import {
  DEFAULT_SCAN_REFRESH,
  isScanRefreshInterval,
  type ScanRefreshPreferences,
  type ScanRefreshState,
} from '../../shared/scan-refresh'

interface Dependencies {
  load: () => Promise<unknown>
  save: (preferences: ScanRefreshPreferences) => Promise<void>
  scan: () => Promise<unknown>
  publish: (state: ScanRefreshState) => void
}

/** A single completion-based timer shared by every visible local-usage view. */
export class ScanRefreshController {
  private state: ScanRefreshState = {
    ...DEFAULT_SCAN_REFRESH,
    revision: 0,
    running: false,
    nextRefreshAt: null,
  }
  private deps: Dependencies
  private loaded?: Promise<void>
  private writing = Promise.resolve()
  private viewers = new Set<number>()
  private timer?: ReturnType<typeof setTimeout>
  private nextDueAt: number | null = null
  private scanRunning = false
  private inFlight = false
  private stopped = false

  constructor(deps: Dependencies) {
    this.deps = deps
  }

  private load(): Promise<void> {
    return (this.loaded ??= this.deps
      .load()
      .then((value) => {
        const saved = value as Partial<ScanRefreshPreferences> | null
        if (saved && typeof saved.enabled === 'boolean' && isScanRefreshInterval(saved.interval)) {
          this.state.enabled = saved.enabled
          this.state.interval = saved.interval
          // Persisted data can be stale after restart. Catch up when a usage view first appears.
          this.nextDueAt = saved.enabled ? Date.now() : null
        }
      })
      .catch((error) => {
        this.loaded = undefined
        throw error
      }))
  }

  async read(): Promise<ScanRefreshState> {
    await this.load()
    return { ...this.state }
  }

  configure(value: ScanRefreshPreferences): Promise<void> {
    if (!value || typeof value.enabled !== 'boolean' || !isScanRefreshInterval(value.interval))
      return Promise.reject(new Error('Invalid scan refresh preferences'))
    const preferences = { enabled: value.enabled, interval: value.interval }
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        await this.load()
        await this.deps.save(preferences)
        if (
          preferences.enabled !== this.state.enabled ||
          preferences.interval !== this.state.interval
        )
          this.nextDueAt = preferences.enabled ? Date.now() + preferences.interval : null
        Object.assign(this.state, preferences)
        this.schedule()
      })
    return this.writing
  }

  async setActive(id: number, active: boolean): Promise<void> {
    await this.load()
    if (this.stopped) return
    const wasActive = this.viewers.size > 0
    if (active) this.viewers.add(id)
    else this.viewers.delete(id)
    // A second window must not postpone the existing deadline.
    const isActive = this.viewers.size > 0
    if (wasActive !== isActive) this.schedule()
  }

  setRunning(running: boolean): void {
    if (this.scanRunning === running) return
    this.scanRunning = running
    this.schedule()
  }

  private schedule(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.state.running = this.scanRunning || this.inFlight
    this.state.nextRefreshAt = null
    if (this.stopped || !this.state.enabled || this.state.running) {
      this.nextDueAt = null
    } else {
      // Hide/pause the timer without postponing its deadline; overdue views catch up once.
      this.nextDueAt ??= Date.now() + this.state.interval
      if (this.viewers.size) {
        this.state.nextRefreshAt = this.nextDueAt
        this.timer = setTimeout(() => void this.tick(), Math.max(0, this.nextDueAt - Date.now()))
      }
    }
    this.state.revision++
    this.deps.publish({ ...this.state })
  }

  private async tick(): Promise<void> {
    if (this.stopped || !this.state.enabled || !this.viewers.size || this.state.running) return
    this.inFlight = true
    this.schedule()
    try {
      await this.deps.scan()
    } catch {
      // Scan progress publishes the error; retain the cadence so a transient failure can recover.
    } finally {
      this.inFlight = false
      this.schedule()
    }
  }

  stop(): void {
    this.stopped = true
    this.viewers.clear()
    this.schedule()
  }
}
