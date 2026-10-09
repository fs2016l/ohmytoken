import type { ScanAgentProgress } from '../../shared/scan-progress'
import type { AgentScanner } from '../scanners/types'
import type { AgentScanPlan } from './incremental-scan-storage.service'
import { runAgentScanJobs, type AgentScanOutput } from './agent-scan-pool'
import type { ScanStaging } from './scan-staging.service'
import type { ScanPreviewAccumulator } from './scan-preview.service'
import type { ScanProgressReporter, ScanExecutionOptions } from './scan-progress.service'
import { getSourceStatesByType } from './scan-source-state.service'

export async function prepareParallelAgents(
  plans: Array<{ scanner: AgentScanner; plan: AgentScanPlan }>,
  staging: ScanStaging | undefined,
  preview: ScanPreviewAccumulator | undefined,
  progress: ScanProgressReporter,
  execution: ScanExecutionOptions,
): Promise<AgentScanOutput[]> {
  const active = new Map<number, ScanAgentProgress>()
  const readAgents = new Set<number>()
  let completedAgents = 0
  const activeAgents = (): ScanAgentProgress[] =>
    [...active.entries()].sort(([left], [right]) => left - right).map(([, value]) => value)
  const jobs = plans.map(({ scanner, plan }, index) => ({
    index,
    agent: scanner.agentName,
    context: { ...plan.context, strict: !!staging, parserWorkers: execution.parserWorkers },
    databasePath: staging?.agentDatabasePath(index),
    sourceStates:
      scanner.agentName === 'codex' && plan.context.mode === 'incremental'
        ? getSourceStatesByType('codex', 'codex-rollout')
        : [],
  }))
  progress.update({ phase: 'reading', agent: undefined, work: undefined }, true)
  return runAgentScanJobs(jobs, execution.agentWorkers!, {
    onProgress: (job, state) => {
      const changedPhase = active.get(job.index)?.phase !== state.phase
      active.set(job.index, state)
      progress.update({ activeAgents: activeAgents() }, changedPhase)
    },
    onPreview: (job, summary) => {
      preview!.merge(summary)
      readAgents.add(job.index)
      const complete = readAgents.size === plans.length
      progress.update(
        {
          phase: complete ? 'writing' : 'reading',
          preview: preview!.snapshot(complete),
        },
        true,
      )
    },
    onComplete: (job) => {
      active.delete(job.index)
      progress.update({ completedAgents: ++completedAgents, activeAgents: activeAgents() }, true)
    },
  })
}
