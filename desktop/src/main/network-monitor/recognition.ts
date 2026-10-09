import type { MonitorPlatform, MonitorProcess, MonitorRule } from '../../shared/network-monitor'
import { isMonitorSharedRuntime as isSharedRuntime } from '../../shared/network-monitor'
export { isMonitorSharedRuntime as isSharedRuntime } from '../../shared/network-monitor'

const definitions = [
  ['claude-code', 'Claude Code', ['claude', 'claude-code'], ['@anthropic-ai/claude-code']],
  ['codex', 'Codex', ['codex'], ['@openai/codex']],
  ['opencode', 'OpenCode', ['opencode'], ['opencode-ai']],
  ['zcode', 'ZCode', ['zcode'], []],
  ['minimax-code', 'MiniMax Code', ['mcode', 'minimax-code'], ['@minimax-ai/code']],
  ['kimiwork', 'Kimi Work', ['kimiwork', 'kimi-work'], []],
  ['kimi-code', 'Kimi Code', ['kimi', 'kimi-cli'], ['kimi_cli']],
  ['workbuddy', 'WorkBuddy', ['workbuddy'], []],
  ['gemini', 'Gemini', ['gemini'], ['@google/gemini-cli']],
  ['qwen', 'Qwen', ['qwen'], ['@qwen-code/qwen-code']],
  ['openclaw', 'OpenClaw', ['openclaw'], ['openclaw']],
  ['grok', 'Grok', ['grok'], ['@vibe-kit/grok-cli']],
  ['zed', 'Zed', ['zed'], []],
  ['goose', 'Goose', ['goose'], []],
  ['hermes', 'Hermes', ['hermes'], ['hermes_cli']],
  [
    'deepseek-harness',
    'DeepSeek Harness',
    ['dsh', 'deepseek-harness', 'deepseek harness'],
    ['@deepseek-ai/dsh'],
  ],
] as const

export function defaultMonitorRules(): MonitorRule[] {
  return definitions.map(([id, name]) => ({
    id: `builtin:${id}`,
    name,
    enabled: true,
    source: 'builtin',
    descendants: true,
  }))
}

export function monitorPath(path: string, platform: MonitorPlatform): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '')
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

function builtinMatch(rule: MonitorRule, process: MonitorProcess): boolean {
  const definition = definitions.find(([id]) => rule.id === `builtin:${id}`)
  if (!definition) return false
  const basename = process.path
    .replaceAll('\\', '/')
    .split('/')
    .at(-1)
    ?.replace(/\.exe$/i, '')
    .toLowerCase()
  const names: readonly string[] = definition[2]
  if (!isSharedRuntime(process.path) && basename && names.includes(basename)) return true
  const entry = process.entryPoint?.replaceAll('\\', '/').toLowerCase()
  if (!entry) return false
  // Python console scripts are usually extensionless bin/kimi or bin/hermes.
  // Only known installed entry names qualify; never match all Python processes.
  if (
    ['builtin:kimi-code', 'builtin:hermes'].includes(rule.id) &&
    /\/(?:bin|scripts)\/[^/]+$/.test(entry) &&
    names.includes(
      entry
        .split('/')
        .at(-1)
        ?.replace(/(?:-script\.py|\.exe)$/i, '') ?? '',
    )
  )
    return true
  const packages: readonly string[] = definition[3]
  return packages.some(
    (name) =>
      entry === `module:${name}` ||
      entry.startsWith(`module:${name}.`) ||
      entry.includes(`/node_modules/${name}/`) ||
      entry.includes(`/site-packages/${name}/`),
  )
}

export function matchesMonitorRule(
  rule: MonitorRule,
  process: MonitorProcess,
  platform: MonitorPlatform,
): boolean {
  if (rule.source === 'builtin') return builtinMatch(rule, process)
  if (rule.instanceKey) return rule.instanceKey === process.key
  if (rule.bundlePath) {
    const bundle = monitorPath(rule.bundlePath, platform)
    const path = monitorPath(process.path, platform)
    if (path !== bundle && !path.startsWith(`${bundle}/`)) return false
    if (rule.bundleId && process.bundleId && rule.bundleId !== process.bundleId) return false
  } else if (
    !rule.executable ||
    monitorPath(rule.executable, platform) !== monitorPath(process.path, platform)
  )
    return false
  if (isSharedRuntime(process.path) && !rule.entryPoint) return false
  return (
    !rule.entryPoint ||
    monitorPath(rule.entryPoint, platform) === monitorPath(process.entryPoint ?? '', platform)
  )
}

export function sameMonitorTarget(
  a: MonitorRule,
  b: MonitorRule,
  platform: MonitorPlatform,
): boolean {
  if (a.instanceKey || b.instanceKey) return !!a.instanceKey && a.instanceKey === b.instanceKey
  return (
    monitorPath(a.bundlePath ?? a.executable ?? '', platform) ===
      monitorPath(b.bundlePath ?? b.executable ?? '', platform) &&
    monitorPath(a.entryPoint ?? '', platform) === monitorPath(b.entryPoint ?? '', platform)
  )
}
