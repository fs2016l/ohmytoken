interface RendererRecoveryOptions {
  canRecover: () => boolean
  reload: () => void
  onExhausted: () => void
  onError: (error: unknown) => void
  now?: () => number
  schedule?: (callback: () => void) => () => void
}

/** Recover transient renderer failures without turning a persistent crash into a reload loop. */
export function createRendererRecovery(options: RendererRecoveryOptions): {
  recover: () => void
  retry: () => void
  dispose: () => void
} {
  const now = options.now ?? Date.now
  const schedule =
    options.schedule ??
    ((callback) => {
      const timer = setTimeout(callback, 1_000)
      return () => clearTimeout(timer)
    })
  let attempts: number[] = []
  let cancelPending: (() => void) | undefined
  let disposed = false
  let notified = false
  const recover = (): void => {
    if (disposed || cancelPending || !options.canRecover()) return
    attempts = attempts.filter((at) => now() - at < 60_000)
    if (attempts.length >= 2) {
      if (!notified) {
        notified = true
        options.onExhausted()
      }
      return
    }
    cancelPending = schedule(() => {
      cancelPending = undefined
      if (disposed || !options.canRecover()) return
      attempts.push(now())
      notified = false
      try {
        options.reload()
      } catch (error) {
        options.onError(error)
        // A synchronous reload failure also uses the bounded recovery budget.
        recover()
      }
    })
  }
  return {
    recover,
    retry: () => {
      attempts = []
      notified = false
      recover()
    },
    dispose: () => {
      disposed = true
      cancelPending?.()
      cancelPending = undefined
    },
  }
}
