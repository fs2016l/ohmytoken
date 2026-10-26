import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'fs'
import type { Dirent } from 'fs'
import { basename, join } from 'path'
import type { SessionTurnStatus } from '../../shared/models'

export interface WorkBuddyTurnEnd {
  sessionId: string
  timestamp: string
  status: SessionTurnStatus
}

/** SDK settlement records are separate from provider stream completion records. */
export function readWorkBuddyTurnEnds(root: string, sinceMs = 0): WorkBuddyTurnEnd[] {
  const result: WorkBuddyTurnEnd[] = []
  const visit = (directory: string, depth = 0): void => {
    if (!existsSync(directory) || depth > 5) return
    let entries: Dirent[]
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(file, depth + 1)
        continue
      }
      if (!file.includes('conversations') || !entry.name.endsWith('.log')) continue
      try {
        const stat = statSync(file)
        if (stat.mtimeMs < sinceMs) continue
        const size = Math.min(stat.size, 128 * 1024)
        const buffer = Buffer.alloc(size)
        const fd = openSync(file, 'r')
        let length: number
        try {
          length = readSync(fd, buffer, 0, size, stat.size - size)
        } finally {
          closeSync(fd)
        }
        const text = buffer.toString('utf8', 0, length)
        const lines = text.split(/\r?\n/)
        if (stat.size > size) lines.shift()
        for (const line of lines) {
          const match = /^(\S+)\s+runtime\.applyStopReason\s+(\{.*\})$/.exec(line)
          if (!match) continue
          let record: Record<string, unknown>
          try {
            record = JSON.parse(match[2]) as Record<string, unknown>
          } catch {
            continue
          }
          const status =
            record.hasFatalError === true ||
            record.hasTurnError === true ||
            record.requestState === 'error'
              ? 'failed'
              : record.requestState === 'cancelled' || record.stopReason === 'cancelled'
                ? 'interrupted'
                : record.event === 'TURN_COMPLETED' &&
                    record.stopReason === 'end_turn' &&
                    record.requestState === 'completed'
                  ? 'completed'
                  : undefined
          if (status)
            result.push({
              sessionId:
                typeof record.conversationId === 'string'
                  ? record.conversationId
                  : basename(file, '.log'),
              timestamp: match[1],
              status,
            })
        }
      } catch {
        /* Logs may rotate between discovery and reading; usage scanning still continues. */
      }
    }
  }
  visit(root)
  return result
}
