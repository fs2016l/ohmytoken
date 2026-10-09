import type { ScanProgress, ScanWorkProgress } from '@shared/scan-progress'

export interface ScanProgressDisplay {
  scanId: string
  startedAt: number
  sequence: number
  value: number
  indeterminate: boolean
}

function fraction(work?: ScanWorkProgress): number | undefined {
  return work?.total && work.total > 0
    ? Math.max(0, Math.min(1, work.completed / work.total))
    : undefined
}

/** Stage milestones, not a percentage of elapsed time. Only a committed scan reaches 1. */
export function advanceScanProgress(
  previous: ScanProgressDisplay | null,
  progress: ScanProgress,
): ScanProgressDisplay {
  if (
    previous &&
    (progress.startedAt < previous.startedAt ||
      (progress.scanId === previous.scanId && progress.sequence <= previous.sequence))
  )
    return previous

  const work = fraction(progress.work)
  let value = 0
  let indeterminate = work === undefined
  if (progress.status === 'complete') {
    value = 1
    indeterminate = false
  } else if (progress.phase === 'committing') value = 0.97 + (work ?? 0) * 0.02
  else if (progress.phase === 'costs') value = 0.9 + (work ?? 0) * 0.06
  else if (progress.totalAgents > 0 && progress.phase !== 'discovering') {
    if (progress.completedAgents === progress.totalAgents) {
      value = 0.8 + (progress.phase === 'writing' ? (work ?? 0) * 0.08 : 0)
    } else {
      const tasks = progress.activeAgents?.length
        ? progress.activeAgents
        : progress.agent
          ? [{ phase: progress.phase, work: progress.work }]
          : []
      const active = tasks.reduce((sum, task) => {
        const amount = fraction(task.work) ?? 0
        return sum + (task.phase === 'writing' ? 0.7 + amount * 0.3 : amount * 0.7)
      }, 0)
      value =
        (Math.min(progress.totalAgents, progress.completedAgents + active) / progress.totalAgents) *
        0.8
      indeterminate = !tasks.length || tasks.some((task) => fraction(task.work) === undefined)
    }
  }
  return {
    scanId: progress.scanId,
    startedAt: progress.startedAt,
    sequence: progress.sequence,
    // File/byte counters can restart for each source. Never move the overall line backwards.
    value: Math.max(previous?.scanId === progress.scanId ? previous.value : 0, value),
    indeterminate: progress.status === 'running' && indeterminate,
  }
}
