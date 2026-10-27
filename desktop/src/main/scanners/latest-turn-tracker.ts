import type { SessionTurnState, SessionTurnStatus } from '../../shared/models'
import { timestampEpochMs } from '../lib/date-utils'

/** Merge migrated lifecycle snapshots by native turn time; earlier sources win exact ties. */
export function mergeLatestTurnStates(states: readonly SessionTurnState[]): SessionTurnState[] {
  const latest = new Map<string, SessionTurnState>()
  for (const state of states) {
    const previous = latest.get(state.sessionId)
    if (
      !previous ||
      state.startedAtMs > previous.startedAtMs ||
      (state.turnId === previous.turnId && state.updatedAtMs > previous.updatedAtMs)
    )
      latest.set(state.sessionId, state)
  }
  return [...latest.values()]
}

export function turnStatusFromReason(reason: unknown): SessionTurnStatus | undefined {
  const value = String(reason ?? '').toLowerCase()
  if (['completed', 'complete', 'end_turn', 'stop', 'success', 'succeeded', 'done'].includes(value))
    return 'completed'
  if (
    [
      'aborted',
      'abort',
      'cancelled',
      'canceled',
      'interrupted',
      'length',
      'max_tokens',
      'max_turns',
      'user_cancelled',
    ].includes(value)
  )
    return 'interrupted'
  if (['failed', 'error', 'errored'].includes(value)) return 'failed'
  if (['waiting', 'waiting_for_user', 'pause_turn'].includes(value)) return 'waiting'
  return undefined
}

/** Lifecycle evidence only. Usage counters are kept in the existing scanner path. */
export class LatestTurnTracker {
  private readonly states = new Map<string, SessionTurnState>()
  constructor(previous?: SessionTurnState) {
    if (previous) this.states.set(previous.sessionId, { ...previous })
  }
  start(
    sessionId: string,
    turnId: string | undefined,
    timestamp: unknown,
    knownRunning = true,
  ): void {
    if (!turnId) return
    const time = this.time(timestamp)
    if (!time) return
    const previous = this.states.get(sessionId)
    if (previous?.turnId === turnId) return
    if (previous && previous.startedAtMs > time) return
    this.states.set(sessionId, {
      sessionId,
      turnId,
      startedAtMs: time,
      updatedAtMs: time,
      ...(knownRunning ? { status: 'running' as const } : {}),
    })
  }
  finish(sessionId: string, status: SessionTurnStatus, timestamp: unknown, turnId?: string): void {
    const previous = this.states.get(sessionId)
    const time = this.time(timestamp)
    if (!previous || !time || time < previous.updatedAtMs || (turnId && turnId !== previous.turnId))
      return
    previous.status = status
    previous.updatedAtMs = Math.max(previous.updatedAtMs, time)
  }
  get(sessionId: string): SessionTurnState | undefined {
    return this.states.get(sessionId)
  }
  values(): SessionTurnState[] {
    return [...this.states.values()]
  }
  clear(): void {
    this.states.clear()
  }
  private time(value: unknown): number {
    if (typeof value !== 'string' && typeof value !== 'number') return 0
    const time = timestampEpochMs(value)
    return Number.isSafeInteger(time) && time > 0 ? time : 0
  }
}
