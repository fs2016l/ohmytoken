import type { UpdateInfo, UpdateState } from '../../shared/updater'

interface HeartbeatUpdateDependencies {
  /** Return the current immutable state object so concurrent operations can be detected. */
  getState(): Promise<UpdateState>
  request(): Promise<UpdateInfo | null>
  publish(state: UpdateState): void
  onError(error: unknown): void
}

/** Check each publication once; busy or unsuccessful checks remain retryable. */
export class HeartbeatUpdateCheck {
  private revision: string | null = null
  private inFlight: Promise<void> | null = null
  private manualOperation: Promise<void> | null = null
  private epoch = 0
  private readonly deps: HeartbeatUpdateDependencies

  constructor(deps: HeartbeatUpdateDependencies) {
    this.deps = deps
  }

  check(revision?: string | null): Promise<void> {
    if (
      typeof revision !== 'string' ||
      !revision.trim() ||
      revision.length > 160 ||
      revision === this.revision
    )
      return Promise.resolve()
    if (this.manualOperation) return Promise.resolve()
    if (this.inFlight) return this.inFlight
    this.inFlight = this.run(revision, this.epoch)
      .catch((error: unknown) => this.deps.onError(error))
      .finally(() => {
        this.inFlight = null
      })
    return this.inFlight
  }

  /** Foreground/startup requests share the same main-process state and invalidate older queries. */
  checkManually(silent = false): Promise<void> {
    if (this.manualOperation) return this.manualOperation
    this.epoch++
    this.manualOperation = this.runManual(silent)
      .catch((error: unknown) => {
        this.revision = null
        throw error
      })
      .finally(() => {
        this.manualOperation = null
      })
    return this.manualOperation
  }

  private async runManual(silent: boolean): Promise<void> {
    const before = await this.deps.getState()
    if (!['idle', 'latest', 'available', 'error'].includes(before.status)) return
    const info = await this.deps.request()
    if ((await this.deps.getState()) !== before) return
    this.deps.publish({
      status: info ? 'available' : silent ? 'idle' : 'latest',
      info,
      progress: null,
      error: null,
    })
  }

  private async run(revision: string, epoch: number): Promise<void> {
    const before = await this.deps.getState()
    if (epoch !== this.epoch) return
    if (!['idle', 'latest', 'available'].includes(before.status)) return
    const info = await this.deps.request()
    // A manual check, download, pause or installation may have started during the request.
    if ((await this.deps.getState()) !== before || epoch !== this.epoch) return
    this.deps.publish({ status: info ? 'available' : 'idle', info, progress: null, error: null })
    this.revision = revision
  }
}
