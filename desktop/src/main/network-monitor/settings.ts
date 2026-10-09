import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MonitorRule, MonitorSettings } from '../../shared/network-monitor'
import { defaultMonitorRules } from './recognition'
import { hasControlCharacters } from './validation'

function text(value: unknown, length: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= length &&
    !hasControlCharacters(value)
  )
}
export function validCustomRule(value: unknown): value is MonitorRule {
  if (!value || typeof value !== 'object') return false
  const rule = value as MonitorRule
  return (
    rule.source === 'custom' &&
    text(rule.id, 100) &&
    rule.id.startsWith('custom:') &&
    text(rule.name, 80) &&
    typeof rule.enabled === 'boolean' &&
    typeof rule.descendants === 'boolean' &&
    text(rule.executable, 4096) &&
    (rule.entryPoint === undefined || text(rule.entryPoint, 4096)) &&
    (rule.bundlePath === undefined || text(rule.bundlePath, 4096)) &&
    (rule.bundleId === undefined || text(rule.bundleId, 256)) &&
    (rule.instanceKey === undefined ||
      (text(rule.instanceKey, 128) && /^\d+:[a-z\d.-]+$/i.test(rule.instanceKey)))
  )
}
export function loadMonitorSettings(path: string): MonitorSettings {
  const result: MonitorSettings = { autoStart: false, rules: defaultMonitorRules() }
  try {
    const raw = readFileSync(path, 'utf8')
    if (raw.length > 256 * 1024) return result
    const saved = JSON.parse(raw) as Partial<MonitorSettings>
    if (!Array.isArray(saved.rules)) return result
    result.autoStart = saved.autoStart === true
    result.fileAssociation = saved.fileAssociation === true
    for (const rule of result.rules) {
      const old = saved.rules.find((row) => row?.id === rule.id)
      if (typeof old?.enabled === 'boolean') rule.enabled = old.enabled
    }
    const ids = new Set(result.rules.map((row) => row.id))
    for (const rule of saved.rules.slice(0, 200)) {
      // Current-instance selections deliberately expire with the app process.
      if (validCustomRule(rule) && !rule.instanceKey && !ids.has(rule.id)) {
        result.rules.push({
          id: rule.id,
          name: rule.name,
          enabled: rule.enabled,
          source: 'custom',
          descendants: rule.descendants,
          executable: rule.executable,
          entryPoint: rule.entryPoint,
          bundlePath: rule.bundlePath,
          bundleId: rule.bundleId,
        })
        ids.add(rule.id)
      }
    }
  } catch {
    /* A missing or invalid local settings file starts with safe defaults. */
  }
  return result
}
export function saveMonitorSettings(path: string, settings: MonitorSettings): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  writeFileSync(
    temp,
    JSON.stringify({
      autoStart: settings.autoStart,
      fileAssociation: settings.fileAssociation === true,
      rules: settings.rules.filter((rule) => !rule.instanceKey),
    }),
    { mode: 0o600 },
  )
  try {
    renameSync(temp, path)
  } finally {
    try {
      unlinkSync(temp)
    } catch {
      /* Renamed successfully or already removed. */
    }
  }
}
