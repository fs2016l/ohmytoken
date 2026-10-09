import { isIP } from 'node:net'
import { hasControlCharacters } from './validation'
import type {
  MonitorCollectorMessage,
  MonitorIssue,
  MonitorProcess,
  MonitorTraffic,
  MonitorFileAccess,
  MonitorFileState,
  MonitorFileIssue,
} from '../../shared/network-monitor'

const issues = new Set<MonitorIssue>([
  'permission-required',
  'permission-denied',
  'collector-missing',
  'extension-required',
  'extension-approval-required',
  'collector-failed',
  'unsupported-platform',
  'events-lost',
  'identity-unavailable',
  'capacity-reached',
  'new-flows-only',
])
type RecordValue = Record<string, unknown>
function object(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid monitor message')
  return value as RecordValue
}
function string(value: unknown, max = 4096): string {
  if (typeof value !== 'string' || value.length > max || hasControlCharacters(value))
    throw new Error('Invalid monitor string')
  return value
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid monitor number')
  return value
}
function key(value: unknown): string {
  const result = string(value, 128)
  if (!/^\d+:[a-z\d.-]+$/i.test(result)) throw new Error('Invalid process identity')
  return result
}
export function parseMonitorProcess(value: unknown): MonitorProcess {
  const row = object(value)
  const result: MonitorProcess = {
    key: key(row.key),
    pid: integer(row.pid),
    parentPid: row.parentPid == null ? null : integer(row.parentPid),
    parentKey: row.parentKey == null ? null : key(row.parentKey),
    startedAt: integer(row.startedAt),
    path: string(row.path),
    name: string(row.name, 256),
  }
  if (!result.key.startsWith(`${result.pid}:`)) throw new Error('Mismatched process identity')
  if (row.entryPoint != null) result.entryPoint = string(row.entryPoint)
  if (row.bundleId != null) result.bundleId = string(row.bundleId, 256)
  if (row.bundlePath != null) result.bundlePath = string(row.bundlePath)
  if (row.exitedAt != null) result.exitedAt = integer(row.exitedAt)
  return result
}
function traffic(value: unknown): MonitorTraffic {
  const row = object(value)
  const protocol = row.protocol,
    counter = row.counter
  if (protocol !== 'tcp' && protocol !== 'udp') throw new Error('Invalid transport')
  if (counter !== 'delta' && counter !== 'cumulative') throw new Error('Invalid counter')
  const localAddress = string(row.localAddress, 64),
    remoteAddress = string(row.remoteAddress, 64)
  if (!isIP(localAddress) || !isIP(remoteAddress)) throw new Error('Invalid address')
  const localPort = integer(row.localPort),
    remotePort = integer(row.remotePort)
  if (localPort > 65535 || remotePort > 65535) throw new Error('Invalid port')
  return {
    processKey: key(row.processKey),
    responsibleKey: row.responsibleKey == null ? undefined : key(row.responsibleKey),
    flowId: string(row.flowId, 512),
    protocol,
    counter,
    localAddress,
    remoteAddress,
    localPort,
    remotePort,
    sent: integer(row.sent),
    received: integer(row.received),
    at: integer(row.at),
    baseline: row.baseline === true,
    closed: row.closed === true,
  }
}
export function parseCollectorMessage(line: string): MonitorCollectorMessage {
  if (line.length > 1024 * 1024) throw new Error('Monitor message too large')
  const row = object(JSON.parse(line))
  switch (row.type) {
    case 'ready':
      if (row.version !== 1) throw new Error('Unsupported monitor protocol')
      return {
        type: 'ready',
        version: 1,
        startedAt: row.startedAt == null ? undefined : integer(row.startedAt),
      }
    case 'processes':
      if (!Array.isArray(row.processes) || row.processes.length > 512)
        throw new Error('Invalid process batch')
      return { type: 'processes', processes: row.processes.map(parseMonitorProcess) }
    case 'traffic':
      if (!Array.isArray(row.samples) || row.samples.length > 2048)
        throw new Error('Invalid traffic batch')
      return { type: 'traffic', samples: row.samples.map(traffic) }
    case 'exit':
      return { type: 'exit', key: key(row.key), at: integer(row.at) }
    case 'unattributed': {
      const gap = object(row.gap)
      const remoteAddress = string(gap.remoteAddress, 64)
      if (!isIP(remoteAddress)) throw new Error('Invalid address')
      return {
        type: 'unattributed',
        gap: {
          parentKey: key(gap.parentKey),
          remoteAddress,
          sent: integer(gap.sent),
          received: integer(gap.received),
          at: integer(gap.at),
        },
      }
    }
    case 'issue':
      if (!issues.has(row.issue as MonitorIssue)) throw new Error('Unknown collector issue')
      return { type: 'issue', issue: row.issue as MonitorIssue }
    case 'stopped':
      return { type: 'stopped' }
    case 'files': {
      if (!Array.isArray(row.files) || row.files.length > 256) throw new Error('Invalid file batch')
      const files = row.files.map((value): MonitorFileAccess => {
        const file = object(value),
          path = string(file.path, 4096)
        if (!path || (file.operation !== 'open' && file.operation !== 'read'))
          throw new Error('Invalid file evidence')
        const firstAt = integer(file.firstAt),
          lastAt = integer(file.lastAt),
          count = integer(file.count)
        if (lastAt < firstAt || !count) throw new Error('Invalid file interval')
        return {
          processKey: key(file.processKey),
          path,
          operation: file.operation,
          firstAt,
          lastAt,
          count,
        }
      })
      return { type: 'files', epoch: integer(row.epoch), files }
    }
    case 'file-status': {
      const state = row.state as MonitorFileState,
        issue = row.issue as MonitorFileIssue | undefined
      if (
        !['off', 'running', 'unavailable', 'permission-required'].includes(state) ||
        (issue !== undefined &&
          !['events-lost', 'capacity-reached', 'path-unavailable'].includes(issue))
      )
        throw new Error('Invalid file status')
      return { type: 'file-status', epoch: integer(row.epoch), state, issue }
    }
    default:
      throw new Error('Unknown monitor message')
  }
}

/** Bounded NDJSON reader; malformed/overlong input ends this collector session. */
export class MonitorMessageReader {
  private buffer = ''
  private receive: (message: MonitorCollectorMessage) => void
  constructor(receive: (message: MonitorCollectorMessage) => void) {
    this.receive = receive
  }
  push(chunk: string): void {
    this.buffer += chunk
    let end: number
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + 1)
      if (line.trim()) this.receive(parseCollectorMessage(line))
    }
    if (this.buffer.length > 1024 * 1024) throw new Error('Monitor message too large')
  }
}
