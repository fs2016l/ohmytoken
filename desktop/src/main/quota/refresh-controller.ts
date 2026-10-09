import {
  QUOTA_REFRESH_INTERVALS,
  type QuotaRefreshInterval,
  type TokenPlanInventory,
  type TokenPlanMonitorState,
  type TokenPlanUsageSnapshot,
} from '../../shared/token-plan'

interface Dependencies {
  read: () => Promise<TokenPlanInventory>
  discover: () => Promise<TokenPlanInventory>
  query: (id: string) => Promise<TokenPlanUsageSnapshot>
  runRefresh?: (work: () => Promise<void>) => Promise<void>
  loadInterval: () => Promise<number>
  saveInterval: (value: QuotaRefreshInterval) => Promise<void>
  publish: (state: TokenPlanMonitorState) => void
}

/** One scheduler and one set of in-flight requests for all quota windows. */
export class QuotaRefreshController {
  private state: TokenPlanMonitorState = {
    revision: 0,
    inventory: { connections: [], snapshots: [], issues: [], checkedSources: [], discoveredAt: 0 },
    refreshInterval: 0,
    discovering: false,
    refreshing: [],
    error: '',
  }
  private loaded?: Promise<void>
  private batch?: Promise<void>
  private requests = new Map<string, Promise<void>>()
  private viewers = new Set<number>()
  private timer?: ReturnType<typeof setTimeout>
  private intervalWrite = Promise.resolve()
  private stopped = false
  private deps: Dependencies

  constructor(deps: Dependencies) {
    this.deps = deps
  }

  private load(): Promise<void> {
    return (this.loaded ??= Promise.all([this.deps.read(), this.deps.loadInterval()])
      .then(([inventory, interval]) => {
        this.state.inventory = inventory
        this.state.refreshInterval = QUOTA_REFRESH_INTERVALS.includes(
          interval as QuotaRefreshInterval,
        )
          ? (interval as QuotaRefreshInterval)
          : 0
      })
      .catch((error) => {
        this.loaded = undefined
        throw error
      }))
  }

  async read(): Promise<TokenPlanMonitorState> {
    await this.load()
    return structuredClone(this.state)
  }

  private publish(): void {
    this.state.revision++
    this.deps.publish(structuredClone(this.state))
  }

  async setActive(id: number, active: boolean): Promise<void> {
    await this.load()
    if (this.stopped) return
    const wasActive = this.viewers.size > 0
    if (active) this.viewers.add(id)
    else this.viewers.delete(id)
    const isActive = this.viewers.size > 0
    if (wasActive !== isActive) this.schedule()
  }

  setInterval(value: number): Promise<void> {
    if (!QUOTA_REFRESH_INTERVALS.includes(value as QuotaRefreshInterval))
      return Promise.reject(new Error('Invalid quota refresh interval'))
    this.intervalWrite = this.intervalWrite
      .catch(() => undefined)
      .then(async () => {
        await this.load()
        await this.deps.saveInterval(value as QuotaRefreshInterval)
        this.state.refreshInterval = value as QuotaRefreshInterval
        this.publish()
        this.schedule()
      })
    return this.intervalWrite
  }

  async refresh(id?: string): Promise<void> {
    const work = (): Promise<void> => this.refreshInScope(id)
    return this.deps.runRefresh ? this.deps.runRefresh(work) : work()
  }

  private async refreshInScope(id?: string): Promise<void> {
    await this.load()
    if (this.batch) return this.batch
    clearTimeout(this.timer)
    this.state.error = ''
    if (id) {
      try {
        await this.refreshConnection(id, true)
      } finally {
        this.schedule()
      }
      return
    }
    this.batch = (async () => {
      this.state.discovering = true
      this.publish()
      try {
        this.state.inventory = await this.deps.discover()
        this.state.discovering = false
        this.publish()
        await Promise.all(
          this.state.inventory.connections.map((row) => this.refreshConnection(row.id)),
        )
      } catch (error) {
        this.state.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.state.discovering = false
        this.publish()
      }
    })().finally(() => {
      this.batch = undefined
      this.schedule()
    })
    return this.batch
  }

  private refreshConnection(id: string, rediscover = false): Promise<void> {
    const running = this.requests.get(id)
    if (running) return running
    const work = (async () => {
      this.state.refreshing.push(id)
      this.publish()
      try {
        if (rediscover) {
          // Re-read the source Agent's login before a manual retry. Broadcast connection
          // metadata as well as quota so every window drops the previous expired state.
          const inventory = await this.deps.discover()
          const ids = new Set(inventory.connections.map((row) => row.id))
          const snapshots = new Map(inventory.snapshots.map((row) => [row.connectionId, row]))
          for (const latest of this.state.inventory.snapshots) {
            const incoming = snapshots.get(latest.connectionId)
            if (
              ids.has(latest.connectionId) &&
              (!incoming || latest.checkedAt > incoming.checkedAt)
            )
              snapshots.set(latest.connectionId, latest)
          }
          this.state.inventory = { ...inventory, snapshots: [...snapshots.values()] }
          this.publish()
        }
        const snapshot = await this.deps.query(id)
        if (this.state.inventory.connections.some((row) => row.id === id)) {
          this.state.inventory.snapshots = [
            ...this.state.inventory.snapshots.filter((row) => row.connectionId !== id),
            snapshot,
          ]
        }
      } catch (error) {
        this.state.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.state.refreshing = this.state.refreshing.filter((value) => value !== id)
        this.publish()
      }
    })().finally(() => this.requests.delete(id))
    this.requests.set(id, work)
    return work
  }

  private schedule(): void {
    clearTimeout(this.timer)
    if (
      this.stopped ||
      !this.viewers.size ||
      !this.state.refreshInterval ||
      this.batch ||
      this.requests.size
    )
      return
    this.timer = setTimeout(() => {
      void this.refresh().catch(() => {})
    }, this.state.refreshInterval)
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.timer)
    this.viewers.clear()
  }
}
