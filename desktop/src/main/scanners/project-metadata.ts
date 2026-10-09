import { readFileSync, statSync } from 'fs'
import { basename, dirname, join, resolve, sep } from 'path'
import { normalizeCollectedProjectPath } from './project-path'

/** 在一次扫描内复用项目索引和目录标记。 */
export function createProjectPathLookup(dataRoot: string): (file: string) => string | undefined {
  const root = resolve(dataRoot)
  const registry = readProjectRegistry(join(root, 'projects.json'))
  const directories = new Map<string, string | undefined>()
  function lookup(directory: string): string | undefined {
    if (directory === root || !directory.startsWith(root.endsWith(sep) ? root : root + sep))
      return undefined
    if (directories.has(directory)) return directories.get(directory)
    const marker = normalizeCollectedProjectPath(
      readText(join(directory, '.project_root'), 32 * 1024),
    )
    const parent = dirname(directory)
    const fromRegistry = ['tmp', 'history', 'projects'].some(
      (folder) => parent === join(root, folder),
    )
      ? registry.get(basename(directory))
      : undefined
    // 两个索引相互矛盾时保持未知，由会话自身的路径字段提供更直接的依据。
    const result =
      marker && fromRegistry && marker !== fromRegistry
        ? undefined
        : (marker ?? fromRegistry ?? lookup(parent))
    directories.set(directory, result)
    return result
  }
  return (file) => lookup(dirname(resolve(file)))
}

function readProjectRegistry(file: string): Map<string, string | undefined> {
  const result = new Map<string, string | undefined>()
  try {
    const data: unknown = JSON.parse(readText(file, 2 * 1024 * 1024))
    if (!data || typeof data !== 'object' || !('projects' in data)) return result
    const projects = data.projects
    if (!projects || typeof projects !== 'object' || Array.isArray(projects)) return result
    for (const [path, id] of Object.entries(projects)) {
      const normalized = normalizeCollectedProjectPath(path)
      if (!normalized || typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) continue
      result.set(id, result.has(id) && result.get(id) !== normalized ? undefined : normalized)
    }
  } catch {
    // 未创建索引或写入尚未结束时，仍可使用会话旁的目录标记。
  }
  return result
}

function readText(file: string, limit: number): string {
  try {
    const info = statSync(file)
    return info.isFile() && info.size <= limit
      ? readFileSync(file, 'utf8')
          .replace(/^\uFEFF/, '')
          .trim()
      : ''
  } catch {
    return ''
  }
}
