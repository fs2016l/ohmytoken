import type {
  MonitorFileAccess,
  MonitorFileActivity,
  MonitorFileAssociation,
  MonitorFileIssue,
  MonitorFileState,
} from '../../shared/network-monitor'

export const FILE_ASSOCIATION_LIMITS = {
  windowMs: 120_000,
  maxFiles: 4096,
  maxUploads: 8192,
  maxEvents: 100,
  maxFilesPerEvent: 50,
  maxConnectionsPerEvent: 20,
  metadataBytes: 8 * 1024 * 1024,
  minimumUpload: 1024 * 1024,
  minimumFiles: 10,
} as const
const archive = /\.(zip|7z|rar|tar|gz|tgz|bz2|xz|zst|jar)$/i
const relevant =
  /(?:\.(?:[cm]?jsx?|tsx?|vue|svelte|py|go|rs|java|kt|swift|[ch](?:pp|xx)?|cs|rb|php|sh|ps1|sql|json[c5l]?|ya?ml|toml|ini|conf|cfg|xml|md|txt|csv|pdf|docx?|xlsx?|pem|key|zip|7z|rar|tar|gz|tgz|bz2|xz|zst|jar)|(?:^|\/)\.env(?:\.[^/]*)?)$/i
export function isAssociationFile(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  return (
    !/(?:^|\/)(node_modules|\.git|\.cache|__pycache__)(?:\/|$)/i.test(normalized) &&
    relevant.test(normalized)
  )
}
interface FileRow {
  groupId: string
  groupName: string
  file: MonitorFileAccess
  cost: number
}
interface UploadRow {
  id: string
  groupId: string
  groupName: string
  address: string
  port: number
  sent: number
  at: number
}
function fileCost(file: MonitorFileAccess): number {
  return 384 + 4 * (file.path.length + file.processKey.length)
}
function uploadCost(row: UploadRow): number {
  return 512 + 4 * (row.id.length + row.address.length + row.groupId.length + row.groupName.length)
}
function eventCost(event: MonitorFileAssociation): number {
  return (
    1024 +
    4 * (event.groupId.length + event.groupName.length) +
    event.files.reduce((sum, file) => sum + fileCost(file), 0) +
    event.connections.reduce((sum, row) => sum + 512 + 4 * (row.id.length + row.address.length), 0)
  )
}

/** Bounded metadata only; byte estimates are a budgeting mechanism, not measured JS heap size. */
export class FileAssociationEngine {
  private state: MonitorFileState = 'off'
  private issues = new Set<MonitorFileIssue>()
  private files = new Map<string, FileRow>()
  private uploads = new Map<string, UploadRow>()
  private events: MonitorFileAssociation[] = []
  private consumed = new Map<string, number>()
  private bytes = 0
  private sequence = 0
  private watermark = 0
  private lastPrune = 0
  reset(enabled: boolean): void {
    this.files.clear()
    this.uploads.clear()
    this.events = []
    this.consumed.clear()
    this.bytes = 0
    this.sequence = 0
    this.watermark = 0
    this.lastPrune = 0
    this.issues.clear()
    this.state = enabled ? 'starting' : 'off'
  }
  configure(enabled: boolean): void {
    this.files.clear()
    this.uploads.clear()
    this.consumed.clear()
    this.bytes = this.events.reduce((sum, event) => sum + eventCost(event), 0)
    this.issues.clear()
    this.state = enabled ? 'starting' : 'off'
  }
  status(state: MonitorFileState, issue?: MonitorFileIssue): void {
    this.state = state
    if (issue) this.issues.add(issue)
  }
  issue(issue: MonitorFileIssue): void {
    this.issues.add(issue)
  }
  stop(): void {
    if (this.state === 'running' || this.state === 'starting') this.state = 'stopped'
  }
  file(groupId: string, groupName: string, file: MonitorFileAccess, now: number): void {
    if (this.state !== 'running' || !isAssociationFile(file.path)) return
    this.prune(now)
    const cutoff = Math.max(
      this.watermark - FILE_ASSOCIATION_LIMITS.windowMs,
      this.consumed.get(groupId) ?? 0,
    )
    if (file.lastAt <= cutoff || file.lastAt > now + 2000) return
    // If the batch spans an expired/consumed interval, only its final observed time is reliable.
    const firstAt = file.firstAt <= cutoff ? file.lastAt : file.firstAt
    const key = groupId + '\n' + file.processKey + '\n' + file.path
    const previous = this.files.get(key)
    if (previous) {
      if (previous.file.firstAt <= cutoff) previous.file.firstAt = previous.file.lastAt
      previous.file.firstAt = Math.min(previous.file.firstAt, firstAt)
      previous.file.lastAt = Math.max(previous.file.lastAt, file.lastAt)
      previous.file.count = Math.min(Number.MAX_SAFE_INTEGER, previous.file.count + file.count)
    } else {
      const size = fileCost(file) + 4 * (groupId.length + groupName.length)
      if (this.files.size >= FILE_ASSOCIATION_LIMITS.maxFiles || !this.reserve(size)) {
        this.issue('capacity-reached')
        return
      }
      this.files.set(key, { groupId, groupName, file: { ...file, firstAt }, cost: size })
      this.bytes += size
    }
  }
  upload(row: UploadRow, now: number): void {
    if (this.state !== 'running' || row.sent <= 0) return
    this.prune(now)
    if (
      row.at < this.watermark - FILE_ASSOCIATION_LIMITS.windowMs ||
      row.at > now + 2000 ||
      row.at <= (this.consumed.get(row.groupId) ?? 0)
    )
      return
    const key = row.groupId + '\n' + row.id + '\n' + Math.floor(row.at / 1000)
    const previous = this.uploads.get(key)
    // Keep the earliest time: a bucket cannot claim that earlier bytes followed a later read.
    if (previous) {
      previous.sent += row.sent
      previous.at = Math.min(previous.at, row.at)
    } else if (
      this.uploads.size < FILE_ASSOCIATION_LIMITS.maxUploads &&
      this.reserve(uploadCost(row))
    ) {
      this.uploads.set(key, { ...row })
      this.bytes += uploadCost(row)
    } else this.issue('capacity-reached')
  }
  sample(now: number): void {
    this.prune(now, true)
    if (this.state !== 'running') return
    const groups = new Map<string, FileRow[]>()
    const uploadsByGroup = new Map<string, UploadRow[]>()
    for (const row of this.files.values()) {
      const rows = groups.get(row.groupId) ?? []
      rows.push(row)
      groups.set(row.groupId, rows)
    }
    for (const row of this.uploads.values()) {
      const rows = uploadsByGroup.get(row.groupId) ?? []
      rows.push(row)
      uploadsByGroup.set(row.groupId, rows)
    }
    for (const [groupId, candidates] of groups) {
      const cutoff = Math.max(
        this.watermark - FILE_ASSOCIATION_LIMITS.windowMs,
        this.consumed.get(groupId) ?? 0,
      )
      const files = candidates
        .filter((row) => row.file.lastAt > cutoff)
        .map((row) => ({
          ...row,
          file: {
            ...row.file,
            firstAt: row.file.firstAt <= cutoff ? row.file.lastAt : row.file.firstAt,
          },
        }))
        .sort((a, b) => a.file.firstAt - b.file.firstAt)
      const paths = new Map<string, number>()
      for (const row of files)
        if (!paths.has(row.file.path)) paths.set(row.file.path, row.file.firstAt)
      const bulkAt = [...paths.values()][FILE_ASSOCIATION_LIMITS.minimumFiles - 1] ?? Infinity
      const archiveAt = files.find((row) => archive.test(row.file.path))?.file.firstAt ?? Infinity
      const gate = Math.min(bulkAt, archiveAt)
      const uploads = (uploadsByGroup.get(groupId) ?? []).filter(
        (row) => row.at > cutoff && row.at >= gate,
      )
      const sent = uploads.reduce((sum, row) => sum + row.sent, 0)
      if (sent < FILE_ASSOCIATION_LIMITS.minimumUpload) continue
      const firstUploadAt = Math.min(...uploads.map((row) => row.at))
      const lastUploadAt = Math.max(...uploads.map((row) => row.at))
      const evidence = files.filter((row) => row.file.firstAt <= lastUploadAt)
      const unique = new Set(evidence.map((row) => row.file.path))
      const connections = new Map<string, MonitorFileAssociation['connections'][number]>()
      for (const upload of uploads) {
        const connection = connections.get(upload.id)
        if (connection) connection.sent += upload.sent
        else
          connections.set(upload.id, {
            id: upload.id,
            address: upload.address,
            port: upload.port,
            sent: upload.sent,
          })
      }
      const event: MonitorFileAssociation = {
        id: 'association-' + ++this.sequence,
        groupId,
        groupName: evidence[0].groupName,
        kind: bulkAt <= firstUploadAt ? 'bulk' : 'archive',
        firstFileAt: evidence[0].file.firstAt,
        firstUploadAt,
        lastUploadAt,
        sent,
        fileCount: unique.size,
        files: evidence
          .slice(0, FILE_ASSOCIATION_LIMITS.maxFilesPerEvent)
          .map((row) =>
            row.file.lastAt <= lastUploadAt
              ? { ...row.file }
              : { ...row.file, lastAt: row.file.firstAt, count: 1 },
          ),
        connections: [...connections.values()]
          .sort((a, b) => b.sent - a.sent)
          .slice(0, FILE_ASSOCIATION_LIMITS.maxConnectionsPerEvent),
        limited:
          evidence.length > FILE_ASSOCIATION_LIMITS.maxFilesPerEvent ||
          connections.size > FILE_ASSOCIATION_LIMITS.maxConnectionsPerEvent ||
          this.issues.size > 0,
      }
      this.events.unshift(event)
      this.bytes += eventCost(event)
      this.consumed.set(groupId, lastUploadAt)
      for (const [key, row] of this.files)
        if (row.groupId === groupId && row.file.lastAt <= lastUploadAt) {
          this.files.delete(key)
          this.bytes -= row.cost
        }
      for (const [key, row] of this.uploads)
        if (row.groupId === groupId && row.at <= lastUploadAt) {
          this.uploads.delete(key)
          this.bytes -= uploadCost(row)
        }
      while (
        this.events.length &&
        (this.events.length > FILE_ASSOCIATION_LIMITS.maxEvents ||
          this.bytes > FILE_ASSOCIATION_LIMITS.metadataBytes)
      ) {
        this.bytes -= eventCost(this.events.pop()!)
      }
    }
  }
  private reserve(bytes: number): boolean {
    // Old incident details must never permanently starve new observations.
    while (this.events.length && this.bytes + bytes > FILE_ASSOCIATION_LIMITS.metadataBytes) {
      this.bytes -= eventCost(this.events.pop()!)
    }
    return this.bytes + bytes <= FILE_ASSOCIATION_LIMITS.metadataBytes
  }
  private prune(now: number, force = false): void {
    this.watermark = Math.max(this.watermark, now)
    if (!force && this.watermark - this.lastPrune < 1000) return
    this.lastPrune = this.watermark
    const cutoff = this.watermark - FILE_ASSOCIATION_LIMITS.windowMs
    for (const [key, row] of this.files)
      if (row.file.lastAt < cutoff) {
        this.files.delete(key)
        this.bytes -= row.cost
      }
    for (const [key, row] of this.uploads)
      if (row.at < cutoff) {
        this.uploads.delete(key)
        this.bytes -= uploadCost(row)
      }
    for (const [key, at] of this.consumed) if (at < cutoff) this.consumed.delete(key)
  }
  snapshot(): MonitorFileActivity {
    return {
      state: this.state,
      issues: [...this.issues],
      events: structuredClone(this.events),
      totalEvents: this.sequence,
      cachedFiles: this.files.size,
      metadataBytes: Math.max(0, this.bytes),
    }
  }
}
