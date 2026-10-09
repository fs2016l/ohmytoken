import { randomUUID } from 'crypto'
import { basename, normalize } from 'path'
import type Database from 'better-sqlite3'
import { normalizeCollectedProjectPath } from '../scanners/project-path'
import {
  createProjectLocationResolver,
  isProjectDirectory,
  type ProjectLocation,
} from './project-location'
import { openDatabase } from './sqlite-storage.service'

interface ProjectEntry {
  id: string
  normalized_path: string
  source: string
  ignored: number
  directories: string[]
}

interface DiscoveryState {
  signature: string
  checkedAt: number
  pending?: Promise<void>
}

const states = new WeakMap<Database.Database, DiscoveryState>()
const RECHECK_MS = 5 * 60_000

/** 项目列表按数据库版本复用，扫描写入新结果后自动更新。 */
export async function discoverProjects(db = openDatabase()): Promise<void> {
  let state = states.get(db)
  if (state?.pending) return state.pending
  const signature = databaseSignature(db)
  if (state?.signature === signature && Date.now() - state.checkedAt < RECHECK_MS) return
  if (!state) {
    state = { signature: '', checkedAt: 0 }
    states.set(db, state)
  }
  const current = state
  current.pending = collectProjects(db)
    .then((beforeWrite) => {
      // 异步读取目录期间若扫描已提交，下一次查询会继续补齐新路径。
      current.signature =
        beforeWrite === signature && databaseSignature(db).split(':')[0] === signature.split(':')[0]
          ? databaseSignature(db)
          : ''
      current.checkedAt = Date.now()
    })
    .finally(() => {
      current.pending = undefined
    })
  return current.pending
}

async function collectProjects(db: Database.Database): Promise<string> {
  const rows = db
    .prepare(
      `SELECT DISTINCT project_path FROM usage_project_totals
    WHERE project_path IS NOT NULL AND project_path <> ''`,
    )
    .all() as Array<{ project_path: string }>
  const paths = [...new Set(rows.map((row) => normalizeCollectedProjectPath(row.project_path)))]
    .filter((path): path is string => !!path && isProjectDirectory(path))
    .sort()
  const locate = createProjectLocationResolver()
  const locations = new Map<string, ProjectLocation>()
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(paths.length, 4) }, async () => {
      while (next < paths.length) {
        const path = paths[next++]
        locations.set(path, await locate(path))
      }
    }),
  )
  const beforeWrite = databaseSignature(db)
  db.transaction(() => {
    const projects = db
      .prepare('SELECT id, normalized_path, source, ignored FROM tracked_projects')
      .all() as ProjectEntry[]
    for (const project of projects) project.directories = [project.normalized_path]
    const byId = new Map(projects.map((project) => [project.id, project]))
    const directories = db
      .prepare('SELECT project_id, normalized_path FROM project_directories')
      .all() as Array<{ project_id: string; normalized_path: string }>
    for (const directory of directories)
      byId.get(directory.project_id)?.directories.push(directory.normalized_path)
    const insert = db.prepare(`INSERT INTO tracked_projects
      (id, name, path, normalized_path, created_at, source, ignored) VALUES (?, ?, ?, ?, ?, 'discovered', 0)`)
    const addDirectory = db.prepare('INSERT OR IGNORE INTO project_directories VALUES (?, ?)')
    for (const path of paths) {
      const location = locations.get(path)!
      const root = normalizeCollectedProjectPath(location.path) ?? path
      const directory = normalizeCollectedProjectPath(location.directory) ?? path
      let directOwner = ownerOf(path, projects)
      if (
        location.repository &&
        directOwner?.source === 'discovered' &&
        !directOwner.ignored &&
        !directOwner.directories.includes(directory)
      )
        directOwner = undefined
      let project = directOwner ?? ownerOf(root, projects)
      if (
        location.repository &&
        project?.source === 'discovered' &&
        !project.ignored &&
        !project.directories.includes(root)
      )
        project = undefined
      if (!project) {
        project = {
          id: randomUUID(),
          normalized_path: root,
          source: 'discovered',
          ignored: 0,
          directories: [root],
        }
        insert.run(
          project.id,
          (basename(root) || root).slice(0, 80),
          normalize(root),
          root,
          Date.now(),
        )
        projects.push(project)
      }
      if (project.ignored) continue
      if (!directOwner && !project.directories.some((parent) => containsPath(directory, parent))) {
        addDirectory.run(project.id, directory)
        project.directories.push(directory)
      }
    }
  })()
  return beforeWrite
}

function containsPath(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : root + '/')
}

function ownerOf(path: string, projects: ProjectEntry[]): ProjectEntry | undefined {
  let match: ProjectEntry | undefined
  let length = -1
  for (const project of projects)
    for (const root of project.directories) {
      if (containsPath(path, root) && root.length > length) {
        match = project
        length = root.length
      }
    }
  return match
}

function localChanges(db: Database.Database): number {
  return (db.prepare('SELECT total_changes() AS count').get() as { count: number }).count
}

function databaseSignature(db: Database.Database): string {
  return `${db.pragma('data_version', { simple: true })}:${localChanges(db)}`
}
