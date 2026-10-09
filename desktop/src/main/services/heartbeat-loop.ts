/** One HTTP heartbeat per installation, shared by every renderer window. */
export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000
const WAKE_COOLDOWN_MS = 3_000

interface RevisionSnapshot {
  revision: string
}

export interface HeartbeatDependencies<T extends RevisionSnapshot> {
  heartbeat(): Promise<{ announcementRevision: string }>
  synchronize(): Promise<T>
  persist(snapshot: T): void
  onError(error: unknown): void
  afterHeartbeat(): void
  now(): number
  schedule(callback: () => void, delay: number): ReturnType<typeof setTimeout>
  cancel(timer: ReturnType<typeof setTimeout>): void
}

export class HeartbeatLoop<T extends RevisionSnapshot> {
  private running = false
  private suspended = false
  private revision: string | null = null
  private epoch = 0
  private pendingIdentityChange = false
  private lastAttempt = -Infinity
  private inFlight: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly deps: HeartbeatDependencies<T>

  constructor(deps: HeartbeatDependencies<T>) {
    this.deps = deps
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.wake(true)
  }

  stop(): void {
    this.running = false
    this.epoch += 1
    this.clearTimer()
  }

  suspend(): void {
    this.suspended = true
    this.clearTimer()
  }
  resume(): void {
    this.suspended = false
    void this.wake()
  }

  /** Login/logout invalidates the revision so delivery receipts use the current identity. */
  wake(identityChanged = false): Promise<void> {
    if (!this.running || this.suspended) return Promise.resolve()
    if (identityChanged) {
      this.revision = null
      this.epoch += 1
      if (this.inFlight) this.pendingIdentityChange = true
    }
    if (this.inFlight) return this.inFlight
    if (!identityChanged && this.deps.now() - this.lastAttempt < WAKE_COOLDOWN_MS) {
      if (!this.timer) {
        this.timer = this.deps.schedule(
          () => {
            void this.wake()
          },
          WAKE_COOLDOWN_MS - (this.deps.now() - this.lastAttempt),
        )
      }
      return Promise.resolve()
    }
    this.clearTimer()
    this.lastAttempt = this.deps.now()
    const epoch = this.epoch
    this.inFlight = this.run(epoch)
      .catch((error: unknown) => this.deps.onError(error))
      .finally(() => {
        this.inFlight = null
        if (!this.running || this.suspended) return
        if (this.pendingIdentityChange) {
          this.pendingIdentityChange = false
          void this.wake(true)
        } else {
          this.timer = this.deps.schedule(() => {
            void this.wake()
          }, HEARTBEAT_INTERVAL_MS)
        }
      })
    return this.inFlight
  }

  private async run(epoch: number): Promise<void> {
    const heartbeat = await this.deps.heartbeat()
    if (!this.running || epoch !== this.epoch) return
    if (heartbeat.announcementRevision !== this.revision) {
      const snapshot = await this.deps.synchronize()
      if (!this.running || epoch !== this.epoch) return
      // Save the complete snapshot before accepting its revision. Failures remain retryable.
      this.deps.persist(snapshot)
      this.revision = snapshot.revision
    }
    this.deps.afterHeartbeat()
  }

  private clearTimer(): void {
    if (this.timer) this.deps.cancel(this.timer)
    this.timer = null
  }
}
