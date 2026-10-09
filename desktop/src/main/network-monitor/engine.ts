import type {
  MonitorAttributionGap,
  MonitorConnection,
  MonitorGroup,
  MonitorIssue,
  MonitorMember,
  MonitorPlatform,
  MonitorProcess,
  MonitorRule,
  MonitorSettings,
  MonitorSnapshot,
  MonitorState,
  MonitorTraffic,
  MonitorFileAccess,
  MonitorFileState,
  MonitorFileIssue,
} from '../../shared/network-monitor'
import { matchesMonitorRule } from './recognition'
import { FileAssociationEngine } from './file-association'

interface Owner {
  rootKey: string
  rule: MonitorRule
}
interface Ledger {
  processKey: string
  responsibleKey?: string
  sent: number
  received: number
  localSent: number
  localReceived: number
  owner: Owner
}
interface Counters {
  sent: number
  received: number
}

export function isLoopback(address: string): boolean {
  return (
    /^127\./.test(address) ||
    address === '::1' ||
    address === '0:0:0:0:0:0:0:1' ||
    /^::ffff:127\./i.test(address)
  )
}

/** Separate process instances, flows and accounting; renderer never resolves ownership. */
export class NetworkMonitorEngine {
  private platform: MonitorPlatform
  private settings: MonitorSettings
  private state: MonitorState = 'off'
  private startedAt: number | null = null
  private stoppedAt: number | null = null
  private issues = new Set<MonitorIssue>()
  private processes = new Map<string, MonitorProcess>()
  private currentPid = new Map<number, string>()
  private generations = new Map<number, Set<string>>()
  private ledger = new Map<string, Ledger>()
  private connections = new Map<
    string,
    MonitorConnection & { ledgerKey: string; pendingSent: number; pendingReceived: number }
  >()
  private files = new FileAssociationEngine()
  private fileEpoch = 0
  private fileSignature = ''
  private flowCounters = new Map<string, Counters>()
  private closedFlows = new Set<string>()
  private lastSample = new Map<string, Counters>()
  private rates = new Map<string, Counters>()
  private ownerCache = new Map<string, Owner | null>()
  private ambiguousParents = new Set<string>()
  private rules: MonitorRule[] = []
  private lastTick = 0
  private trend: MonitorSnapshot['trend'] = []
  private unknownEvents = 0
  private unattributedSent = 0
  private unattributedReceived = 0
  private unattributedLocalSent = 0
  private unattributedLocalReceived = 0

  constructor(platform: MonitorPlatform, settings: MonitorSettings) {
    this.platform = platform
    this.settings = structuredClone(settings)
    this.configure(settings)
  }

  configure(settings: MonitorSettings): void {
    const signature = JSON.stringify([!!settings.fileAssociation, settings.rules])
    if (signature !== this.fileSignature) {
      this.fileSignature = signature
      this.fileEpoch++
      this.files.configure(!!settings.fileAssociation)
      if (this.state !== 'running' && this.state !== 'starting') this.files.stop()
    }
    this.settings = structuredClone(settings)
    this.rules = [...this.settings.rules].sort(
      (a, b) => Number(a.source === 'builtin') - Number(b.source === 'builtin'),
    )
    this.ownerCache.clear()
  }
  begin(at = Date.now()): void {
    this.fileEpoch++
    this.files.reset(!!this.settings.fileAssociation)
    this.state = 'starting'
    this.startedAt = at
    this.stoppedAt = null
    this.lastTick = at
    this.issues.clear()
    this.processes.clear()
    this.currentPid.clear()
    this.generations.clear()
    this.ledger.clear()
    this.connections.clear()
    this.flowCounters.clear()
    this.closedFlows.clear()
    this.lastSample.clear()
    this.rates.clear()
    this.ownerCache.clear()
    this.trend = []
    this.ambiguousParents.clear()
    this.unknownEvents = 0
    this.unattributedSent = 0
    this.unattributedReceived = 0
    this.unattributedLocalSent = 0
    this.unattributedLocalReceived = 0
  }
  ready(at?: number): void {
    if (this.state === 'starting') {
      this.state = 'running'
      if (at !== undefined) {
        this.startedAt = at
        this.lastTick = at
      }
      this.issues.delete('extension-approval-required')
    }
  }
  stop(at = Date.now()): void {
    this.files.stop()
    if (this.state === 'starting') {
      this.state = 'off'
      this.startedAt = null
      this.stoppedAt = null
      return
    }
    if (this.state === 'running') this.state = 'stopped'
    this.stoppedAt = at
  }
  fail(issue: MonitorIssue, at = Date.now()): void {
    this.files.stop()
    this.issue(issue)
    this.state = 'error'
    this.stoppedAt = at
  }
  issue(issue: MonitorIssue): void {
    this.issues.add(issue)
    if (issue === 'events-lost' && this.settings.fileAssociation) this.files.issue('events-lost')
  }

  fileConfiguration(): {
    epoch: number
    enabled: boolean
    targets: Array<{ key: string; descendants: boolean }>
  } {
    const enabled = !!this.settings.fileAssociation && ['starting', 'running'].includes(this.state)
    const targets: Array<{ key: string; descendants: boolean }> = []
    if (enabled)
      for (const process of this.processes.values()) {
        const owner = this.owner(process.key)
        if (!process.exitedAt && owner?.rule.enabled)
          targets.push({ key: process.key, descendants: owner.rule.descendants })
      }
    return { epoch: this.fileEpoch, enabled, targets }
  }
  fileStatus(epoch: number, state: MonitorFileState, issue?: MonitorFileIssue): void {
    if (
      epoch === this.fileEpoch &&
      this.settings.fileAssociation &&
      ['starting', 'running'].includes(this.state)
    )
      this.files.status(state, issue)
  }
  fileAccess(epoch: number, file: MonitorFileAccess, at = Date.now()): void {
    if (
      epoch !== this.fileEpoch ||
      !this.settings.fileAssociation ||
      !['starting', 'running'].includes(this.state) ||
      this.startedAt === null ||
      file.firstAt < this.startedAt
    )
      return
    const process = this.processes.get(file.processKey)
    if (
      !process ||
      process.startedAt > file.firstAt ||
      (process.exitedAt && process.exitedAt < file.firstAt)
    )
      return
    const owner = this.owner(file.processKey)
    if (owner?.rule.enabled) this.files.file(owner.rootKey, owner.rule.name, file, at)
  }

  addProcesses(processes: MonitorProcess[]): void {
    this.ownerCache.clear()
    // Resolve the initial snapshot only after installing all process instances.
    for (const process of processes) {
      if (!this.processes.has(process.key) && this.processes.size >= 20000) {
        this.issue('capacity-reached')
        continue
      }
      const existing = this.processes.get(process.key)
      const merged = {
        ...existing,
        ...process,
        parentKey: existing?.parentKey ?? process.parentKey,
        exitedAt: existing?.exitedAt ?? process.exitedAt,
      }
      this.processes.set(process.key, merged)
      const generations = this.generations.get(process.pid) ?? new Set<string>()
      generations.add(process.key)
      this.generations.set(process.pid, generations)
      const current = this.processes.get(this.currentPid.get(process.pid) ?? '')
      if (!merged.exitedAt && (!current || current.startedAt <= process.startedAt)) {
        if (current && current.key !== process.key) current.exitedAt = process.startedAt
        this.currentPid.set(process.pid, process.key)
      }
    }
    for (const process of this.processes.values()) {
      if (process.parentKey || !process.parentPid) continue
      const candidates = [...(this.generations.get(process.parentPid) ?? [])]
        .map((key) => this.processes.get(key)!)
        .filter(
          (parent) =>
            parent.key !== process.key &&
            parent.startedAt <= process.startedAt &&
            (!parent.exitedAt || parent.exitedAt >= process.startedAt),
        )
      if (candidates.length === 1) {
        process.parentKey = candidates[0].key
        this.ambiguousParents.delete(process.key)
      } else if (candidates.length > 1) this.ambiguousParents.add(process.key)
    }
  }
  exit(key: string, at: number): void {
    const process = this.processes.get(key)
    if (!process) return
    process.exitedAt = at
    if (this.currentPid.get(process.pid) === key) this.currentPid.delete(process.pid)
  }
  listProcesses(): MonitorProcess[] {
    return [...this.processes.values()].filter((row) => !row.exitedAt).map((row) => ({ ...row }))
  }

  private owner(key: string): Owner | null {
    if (this.ownerCache.has(key)) return this.ownerCache.get(key)!
    const chain: MonitorProcess[] = []
    const seen = new Set<string>()
    let current = this.processes.get(key)
    while (current && !seen.has(current.key) && chain.length < 128) {
      seen.add(current.key)
      chain.unshift(current)
      current = current.parentKey ? this.processes.get(current.parentKey) : undefined
    }
    for (const process of chain) {
      // An explicit application rule overrides that process's automatic label, without a second count.
      const rule = this.rules.find(
        (rule) =>
          (process.key === key || rule.descendants) &&
          matchesMonitorRule(rule, process, this.platform),
      )
      if (rule) {
        const owner = { rootKey: process.key, rule }
        this.ownerCache.set(key, owner)
        return owner
      }
    }
    this.ownerCache.set(key, null)
    return null
  }

  private trafficOwner(processKey: string, responsibleKey?: string): Owner | null {
    const owner = this.owner(processKey)
    if (owner || !responsibleKey) return owner
    const responsible = this.owner(responsibleKey)
    return responsible?.rule.descendants ? responsible : null
  }

  unattributed(gap: MonitorAttributionGap): void {
    if (
      !['starting', 'running'].includes(this.state) ||
      this.startedAt === null ||
      gap.at < this.startedAt ||
      ![gap.sent, gap.received].every((value) => Number.isSafeInteger(value) && value >= 0) ||
      gap.sent + gap.received === 0
    )
      return
    const owner = this.owner(gap.parentKey)
    // Metadata races in unrelated applications must not taint Agent totals.
    if (!owner?.rule.enabled || !owner.rule.descendants) return
    this.recordUnattributed(gap)
  }

  private recordUnattributed(
    gap: Pick<MonitorAttributionGap, 'sent' | 'received' | 'remoteAddress'>,
  ): void {
    if (gap.sent + gap.received === 0) return
    this.unknownEvents++
    this.issue('identity-unavailable')
    if (isLoopback(gap.remoteAddress)) {
      this.unattributedLocalSent += gap.sent
      this.unattributedLocalReceived += gap.received
    } else {
      this.unattributedSent += gap.sent
      this.unattributedReceived += gap.received
    }
  }

  traffic(sample: MonitorTraffic): void {
    if (
      (this.state !== 'running' && this.state !== 'starting') ||
      this.startedAt === null ||
      sample.at < this.startedAt
    )
      return
    if (
      ![sample.sent, sample.received].every((value) => Number.isSafeInteger(value) && value >= 0)
    ) {
      this.issue('events-lost')
      return
    }
    let sent = sample.sent,
      received = sample.received
    const flowKey = `${sample.processKey}\n${sample.flowId}`
    if (sample.counter === 'cumulative') {
      if (this.closedFlows.has(flowKey)) return
      const previous = this.flowCounters.get(flowKey)
      if (!previous && this.flowCounters.size >= 10000) {
        this.issue('capacity-reached')
        return
      }
      this.flowCounters.set(flowKey, { sent, received })
      // The first observation of a pre-existing flow establishes a baseline, not historical usage.
      if (previous && (sent < previous.sent || received < previous.received)) {
        this.issue('events-lost')
        sent = 0
        received = 0
      } else {
        sent = previous ? sent - previous.sent : sample.baseline ? 0 : sent
        received = previous ? received - previous.received : sample.baseline ? 0 : received
      }
    }
    if (sample.closed) {
      this.flowCounters.delete(flowKey)
      this.closedFlows.add(flowKey)
      if (this.closedFlows.size > 10000)
        this.closedFlows.delete(this.closedFlows.values().next().value!)
    }
    const process = this.processes.get(sample.processKey)
    if (!process) {
      this.recordUnattributed({ ...sample, sent, received })
      return
    }
    const owner = this.trafficOwner(process.key, sample.responsibleKey)
    if (!owner) {
      const seen = new Set<string>()
      let ancestor: MonitorProcess | undefined = process
      while (ancestor && !seen.has(ancestor.key)) {
        seen.add(ancestor.key)
        if (this.ambiguousParents.has(ancestor.key)) {
          this.recordUnattributed({ ...sample, sent, received })
          break
        }
        ancestor = ancestor.parentKey ? this.processes.get(ancestor.parentKey) : undefined
      }
    }
    if (!owner?.rule.enabled) return
    const ledgerKey = `${process.key}\n${sample.responsibleKey ?? ''}`
    if (!this.ledger.has(ledgerKey) && this.ledger.size >= 30000) {
      this.issue('capacity-reached')
      return
    }
    const counters = this.ledger.get(ledgerKey) ?? {
      processKey: process.key,
      responsibleKey: sample.responsibleKey,
      sent: 0,
      received: 0,
      localSent: 0,
      localReceived: 0,
      owner,
    }
    counters.owner = owner
    const local = isLoopback(sample.remoteAddress)
    if (local) {
      counters.localSent += sent
      counters.localReceived += received
    } else {
      counters.sent += sent
      counters.received += received
    }
    this.ledger.set(ledgerKey, counters)
    const connection = this.connections.get(flowKey) ?? {
      id: flowKey,
      ledgerKey,
      processKey: process.key,
      protocol: sample.protocol,
      remoteAddress: sample.remoteAddress,
      remotePort: sample.remotePort,
      localAddress: sample.localAddress,
      localPort: sample.localPort,
      sent: 0,
      received: 0,
      firstSeenAt: sample.at,
      lastSeenAt: sample.at,
      local,
      sendRate: 0,
      receiveRate: 0,
      pendingSent: 0,
      pendingReceived: 0,
    }
    connection.sent += sent
    connection.received += received
    connection.pendingSent += sent
    connection.pendingReceived += received
    if (sample.closed) connection.closed = true
    connection.firstSeenAt = Math.min(connection.firstSeenAt, sample.at)
    if (sent || received) connection.lastSeenAt = Math.max(connection.lastSeenAt, sample.at)
    this.connections.delete(flowKey)
    this.connections.set(flowKey, connection)
    if (this.connections.size > 2000) this.connections.delete(this.connections.keys().next().value!)
    if (!local && sent)
      this.files.upload(
        {
          id: flowKey,
          groupId: owner.rootKey,
          groupName: owner.rule.name,
          address: sample.remoteAddress,
          port: sample.remotePort,
          sent,
          at: sample.at,
        },
        Date.now(),
      )
  }

  /** Called once a second by the service. Reading a snapshot never changes rates. */
  sample(at = Date.now()): void {
    const elapsed = (at - this.lastTick) / 1000
    if (this.state !== 'running' || elapsed <= 0) return
    for (const connection of this.connections.values()) {
      connection.sendRate = connection.pendingSent / elapsed
      connection.receiveRate = connection.pendingReceived / elapsed
      connection.pendingSent = 0
      connection.pendingReceived = 0
    }
    this.files.sample(at)
    let sent = 0,
      received = 0
    for (const [key, ledger] of this.ledger) {
      const previous = this.lastSample.get(key) ?? { sent: 0, received: 0 }
      const rate = {
        sent: Math.max(0, ledger.sent - previous.sent) / elapsed,
        received: Math.max(0, ledger.received - previous.received) / elapsed,
      }
      this.rates.set(key, rate)
      this.lastSample.set(key, { sent: ledger.sent, received: ledger.received })
      sent += rate.sent
      received += rate.received
    }
    this.trend.push({ at, sent, received })
    this.trend = this.trend.filter((point) => point.at > at - 60000).slice(-60)
    this.lastTick = at
  }

  snapshot(at = Date.now()): MonitorSnapshot {
    const groups = new Map<string, MonitorGroup>()
    const memberMaps = new Map<string, Map<string, MonitorMember>>()
    const ledgerGroups = new Map<string, string>()
    const addMember = (
      group: MonitorGroup,
      process: MonitorProcess,
      reason: MonitorMember['reason'],
    ): MonitorMember => {
      const map = memberMaps.get(group.id)!
      let member = map.get(process.key)
      if (!member) {
        member = { ...process, sent: 0, received: 0, localSent: 0, localReceived: 0, reason }
        map.set(process.key, member)
        group.members.push(member)
        if (!process.exitedAt) group.liveProcesses++
      }
      return member
    }
    const getGroup = (owner: Owner): MonitorGroup => {
      const id = owner.rootKey
      let group = groups.get(id)
      if (!group) {
        group = {
          id,
          rootKey: owner.rootKey,
          ruleId: owner.rule.id,
          name: owner.rule.name,
          source: owner.rule.source,
          enabled: owner.rule.enabled,
          sent: 0,
          received: 0,
          localSent: 0,
          localReceived: 0,
          sendRate: 0,
          receiveRate: 0,
          liveProcesses: 0,
          members: [],
          connections: [],
        }
        groups.set(id, group)
        memberMaps.set(id, new Map())
        const root = this.processes.get(owner.rootKey)
        if (root) addMember(group, root, 'application')
      }
      return group
    }
    for (const process of this.processes.values()) {
      const owner = this.owner(process.key)
      if (owner && !process.exitedAt)
        addMember(
          getGroup(owner),
          process,
          process.key === owner.rootKey ? 'application' : 'descendant',
        )
    }
    for (const [key, ledger] of this.ledger) {
      const process = this.processes.get(ledger.processKey)
      if (!process) continue
      const owner = this.trafficOwner(process.key, ledger.responsibleKey) ?? ledger.owner
      const group = getGroup(owner)
      ledgerGroups.set(key, group.id)
      const member = addMember(
        group,
        process,
        process.key === owner.rootKey
          ? 'application'
          : ledger.responsibleKey && !this.owner(process.key)
            ? 'responsible-app'
            : 'descendant',
      )
      member.sent += ledger.sent
      member.received += ledger.received
      member.localSent += ledger.localSent
      member.localReceived += ledger.localReceived
      group.sent += ledger.sent
      group.received += ledger.received
      group.localSent += ledger.localSent
      group.localReceived += ledger.localReceived
      if (this.state === 'running') {
        const rate = this.rates.get(key)
        group.sendRate += rate?.sent ?? 0
        group.receiveRate += rate?.received ?? 0
      }
    }
    for (const connection of this.connections.values()) {
      const {
        ledgerKey,
        pendingSent: _pendingSent,
        pendingReceived: _pendingReceived,
        ...publicConnection
      } = connection
      if (this.state !== 'running') {
        publicConnection.sendRate = 0
        publicConnection.receiveRate = 0
      }
      groups.get(ledgerGroups.get(ledgerKey) ?? '')?.connections.push(publicConnection)
    }
    let sent = 0,
      received = 0,
      sendRate = 0,
      receiveRate = 0
    for (const group of groups.values()) {
      sent += group.sent
      received += group.received
      sendRate += group.sendRate
      receiveRate += group.receiveRate
      group.connections.sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    }
    return {
      state: this.state,
      platform: this.platform,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      updatedAt: at,
      issues: [...this.issues],
      complete: this.issues.size === 0,
      settings: structuredClone(this.settings),
      sent,
      received,
      sendRate,
      receiveRate,
      groups: [...groups.values()].sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name)),
      trend: this.trend.map((point) => ({ ...point })),
      unknownEvents: this.unknownEvents,
      unattributedSent: this.unattributedSent,
      unattributedReceived: this.unattributedReceived,
      unattributedLocalSent: this.unattributedLocalSent,
      unattributedLocalReceived: this.unattributedLocalReceived,
      fileActivity: this.files.snapshot(),
    }
  }
}
