export type MonitorPlatform = 'win32' | 'darwin'

export function isMonitorSharedRuntime(path: string): boolean {
  return /^(node|nodejs|python[\d.wtdm-]*|pypy[\d.wtdm-]*|bun|deno)(?:\.exe)?$/i.test(
    path.replaceAll('\\', '/').split('/').at(-1) ?? '',
  )
}

export function isMonitorPersistentEntry(entry: string | undefined): entry is string {
  if (!entry) return false
  const path = entry.replaceAll('\\', '/')
  return (
    path.startsWith('/') ||
    /^[a-z]:\//i.test(path) ||
    /^module:(?:kimi_cli|hermes_cli)(?:\.[a-z\d_]+)*$/i.test(path)
  )
}
export type MonitorState = 'off' | 'starting' | 'running' | 'stopped' | 'error'
export type MonitorIssue =
  | 'permission-required'
  | 'permission-denied'
  | 'collector-missing'
  | 'extension-required'
  | 'extension-approval-required'
  | 'collector-failed'
  | 'unsupported-platform'
  | 'events-lost'
  | 'identity-unavailable'
  | 'capacity-reached'
  | 'new-flows-only'

export interface MonitorProcess {
  key: string
  pid: number
  parentPid: number | null
  parentKey: string | null
  startedAt: number
  path: string
  name: string
  /** Only the script/module entry point. Raw command lines never enter renderer data. */
  entryPoint?: string
  bundleId?: string
  bundlePath?: string
  exitedAt?: number
}

export interface MonitorRule {
  id: string
  name: string
  enabled: boolean
  source: 'builtin' | 'custom'
  executable?: string
  bundleId?: string
  bundlePath?: string
  entryPoint?: string
  instanceKey?: string
  descendants: boolean
}

export interface MonitorSettings {
  autoStart: boolean
  fileAssociation?: boolean
  rules: MonitorRule[]
}

export interface MonitorTraffic {
  processKey: string
  /** macOS source-app audit token, scoped to this flow rather than the shared helper. */
  responsibleKey?: string
  flowId: string
  protocol: 'tcp' | 'udp'
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  sent: number
  received: number
  counter: 'delta' | 'cumulative'
  /** First report from a flow that existed before this run: establish a baseline only. */
  baseline?: boolean
  closed?: boolean
  at: number
}

export interface MonitorConnection {
  id: string
  processKey: string
  protocol: 'tcp' | 'udp'
  remoteAddress: string
  remotePort: number
  localAddress: string
  localPort: number
  sent: number
  received: number
  firstSeenAt: number
  lastSeenAt: number
  local: boolean
  sendRate: number
  receiveRate: number
  closed?: boolean
}

export type MonitorFileState =
  'off' | 'starting' | 'running' | 'stopped' | 'unavailable' | 'permission-required'
export type MonitorFileIssue = 'events-lost' | 'capacity-reached' | 'path-unavailable'
export interface MonitorFileAccess {
  processKey: string
  path: string
  operation: 'read' | 'open'
  firstAt: number
  lastAt: number
  count: number
}
export interface MonitorFileAssociation {
  id: string
  groupId: string
  groupName: string
  kind: 'bulk' | 'archive'
  firstFileAt: number
  firstUploadAt: number
  lastUploadAt: number
  sent: number
  fileCount: number
  files: MonitorFileAccess[]
  connections: Array<{ id: string; address: string; port: number; sent: number }>
  limited: boolean
}
export interface MonitorFileActivity {
  state: MonitorFileState
  issues: MonitorFileIssue[]
  events: MonitorFileAssociation[]
  totalEvents: number
  cachedFiles: number
  /** Estimated metadata budget, not the process RSS. */
  metadataBytes: number
}

/** Observed bytes from a short-lived process whose executable could not be verified. */
export interface MonitorAttributionGap {
  parentKey: string
  remoteAddress: string
  sent: number
  received: number
  at: number
}

export interface MonitorMember extends MonitorProcess {
  sent: number
  received: number
  localSent: number
  localReceived: number
  reason: 'application' | 'descendant' | 'responsible-app'
}

export interface MonitorGroup {
  id: string
  ruleId: string
  name: string
  rootKey: string
  source: MonitorRule['source']
  enabled: boolean
  sent: number
  received: number
  localSent: number
  localReceived: number
  sendRate: number
  receiveRate: number
  liveProcesses: number
  members: MonitorMember[]
  connections: MonitorConnection[]
}

export interface MonitorSnapshot {
  state: MonitorState
  platform: string
  startedAt: number | null
  stoppedAt: number | null
  updatedAt: number
  issues: MonitorIssue[]
  complete: boolean
  settings: MonitorSettings
  sent: number
  received: number
  sendRate: number
  receiveRate: number
  groups: MonitorGroup[]
  trend: Array<{ at: number; sent: number; received: number }>
  unknownEvents: number
  unattributedSent: number
  unattributedReceived: number
  unattributedLocalSent: number
  unattributedLocalReceived: number
  fileActivity: MonitorFileActivity
}

export interface MonitorApplicationChoice {
  path: string
  name: string
  bundleId?: string
  bundlePath?: string
  sharedRuntime: boolean
}

export interface MonitorAddApplication extends MonitorApplicationChoice {
  descendants: boolean
  entryPoint?: string
  instanceKey?: string
}

/** Collector protocol is local-only, versioned, and contains no packet contents. */
export type MonitorCollectorMessage =
  | { type: 'ready'; version: 1; startedAt?: number }
  | { type: 'processes'; processes: MonitorProcess[] }
  | { type: 'exit'; key: string; at: number }
  | { type: 'traffic'; samples: MonitorTraffic[] }
  | { type: 'unattributed'; gap: MonitorAttributionGap }
  | { type: 'issue'; issue: MonitorIssue }
  | { type: 'stopped' }
  | { type: 'files'; epoch: number; files: MonitorFileAccess[] }
  | { type: 'file-status'; epoch: number; state: MonitorFileState; issue?: MonitorFileIssue }
