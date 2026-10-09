import { readFile, stat } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { basename, dirname, isAbsolute, join, parse, resolve } from 'path'
import { normalizeCollectedProjectPath } from '../scanners/project-path'

export interface ProjectLocation {
  path: string
  directory: string
  repository?: boolean
}

export function isProjectDirectory(path: string): boolean {
  const normalized = normalizeCollectedProjectPath(path)
  if (!normalized) return false
  return ![homedir(), tmpdir(), parse(path).root].some(
    (excluded) => normalizeCollectedProjectPath(excluded) === normalized,
  )
}

/** 只检查已知工作目录的祖先，不遍历项目文件。 */
export function createProjectLocationResolver(): (path: string) => Promise<ProjectLocation> {
  const roots = new Map<string, Promise<ProjectLocation | undefined>>()
  async function findRoot(directory: string, depth = 0): Promise<ProjectLocation | undefined> {
    if (depth > 40 || !isProjectDirectory(directory)) return undefined
    const pending = roots.get(directory)
    if (pending) return pending
    const work = (async () => {
      const git = join(directory, '.git')
      const entry = await stat(git).catch(() => undefined)
      if (entry?.isDirectory()) return { path: directory, directory, repository: true }
      if (entry?.isFile()) {
        const reference = (await readSmallFile(git)).match(/^gitdir:\s*(.+)$/im)?.[1]?.trim()
        if (!reference) return { path: directory, directory, repository: true }
        const gitDirectory = isAbsolute(reference) ? reference : resolve(directory, reference)
        const common = (await readSmallFile(join(gitDirectory, 'commondir'))).trim()
        if (common) {
          const commonDirectory = resolve(gitDirectory, common)
          if (basename(commonDirectory) === '.git') {
            const root = dirname(commonDirectory)
            if (isProjectDirectory(root)) return { path: root, directory, repository: true }
          }
        }
        return { path: directory, directory, repository: true }
      }
      const parent = dirname(directory)
      return parent === directory ? undefined : findRoot(parent, depth + 1)
    })()
    roots.set(directory, work)
    return work
  }
  return async (path) => {
    // 网络目录仅采用已有路径，避免离线共享拖住本地项目列表。
    if (/^(?:\\\\|\/\/)/.test(path)) return { path, directory: path }
    return (await findRoot(path)) ?? { path, directory: path }
  }
}

async function readSmallFile(path: string): Promise<string> {
  const info = await stat(path).catch(() => undefined)
  if (!info?.isFile() || info.size > 64 * 1024) return ''
  return readFile(path, 'utf8').catch(() => '')
}
