import { readFileSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

export interface MiniMaxDesktopStore {
  file: string
  region: 'cn' | 'global'
}

/** Production desktop identities from MiniMax Code's app-identity and storage modules. */
export function miniMaxDesktopStores(
  home: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): MiniMaxDesktopStore[] {
  const base =
    platform === 'win32'
      ? env.APPDATA || join(home, 'AppData', 'Roaming')
      : platform === 'darwin'
        ? join(home, 'Library', 'Application Support')
        : env.XDG_CONFIG_HOME || join(home, '.config')
  return [
    { file: join(base, 'MiniMax', 'minimax-agent-cn-config.json'), region: 'cn' },
    { file: join(base, 'MiniMax Agent', 'minimax-agent-config.json'), region: 'global' },
  ]
}

export function miniMaxProfileRoots(parent: string): string[] {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith('.minimax-') &&
          entry.name.length > '.minimax-'.length &&
          entry.name !== '.minimax-code',
      )
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
      .map((name) => join(parent, name))
  } catch {
    return []
  }
}

export function miniMaxDesktopDataRoots(
  home: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  // The desktop relocation control is currently Windows-only. It stores a parent,
  // then appends .minimax (or a profile basename), rather than storing the data root.
  if (platform !== 'win32') return []
  const parents: string[] = []
  for (const { file } of miniMaxDesktopStores(home, env, platform)) {
    try {
      if (statSync(file).size > 1024 * 1024) continue
      const bytes = readFileSync(file)
      if (bytes.length > 1024 * 1024) continue
      const store: unknown = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
      if (!store || typeof store !== 'object' || Array.isArray(store)) continue
      const config: unknown = (store as Record<string, unknown>).config
      if (!config || typeof config !== 'object' || Array.isArray(config)) continue
      const settings = config as Record<string, unknown>
      for (const parent of [
        settings.localRuntimeDataParentDir,
        ...(Array.isArray(settings.localRuntimePreviousDataParentDirs)
          ? settings.localRuntimePreviousDataParentDirs
          : []),
      ]) {
        if (typeof parent !== 'string' || !isAbsolute(parent.trim()) || parent.includes('\0'))
          continue
        parents.push(parent.trim())
      }
    } catch {
      // Missing or unreadable desktop settings must not hide the default histories.
      // Credential discovery separately reports unreadable/invalid configuration.
    }
  }
  return [...new Set(parents)].flatMap((parent) => [
    join(parent, '.minimax'),
    ...miniMaxProfileRoots(parent),
  ])
}
