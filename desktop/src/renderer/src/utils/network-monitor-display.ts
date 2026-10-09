export function monitorBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(Math.max(1, bytes)) / Math.log(1024)),
  )
  return `${(bytes / 1024 ** index).toLocaleString(undefined, { maximumFractionDigits: index ? 2 : 0 })} ${units[index]}`
}
export function monitorDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
export function monitorEndpoint(address: string, port: number): string {
  return `${address.includes(':') ? `[${address}]` : address}:${port}`
}

export function monitorTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false })
}

export function monitorHasTraffic(member: MonitorMember): boolean {
  return member.sent + member.received + member.localSent + member.localReceived > 0
}

export function monitorTrafficProcesses(groups: MonitorGroup[]): number {
  return new Set(
    groups.flatMap((group) => group.members.filter(monitorHasTraffic).map((row) => row.key)),
  ).size
}
import type { MonitorGroup, MonitorMember } from '@shared/network-monitor'
