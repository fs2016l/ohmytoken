import { isAbsolute, normalize, resolve } from 'path'
import { fileURLToPath } from 'url'

const DIRECT_PATH_KEYS = [
  'cwd',
  'directory',
  'workingDirectory',
  'working_directory',
  'workspace',
  'workspacePath',
  'workspace_path',
  'workspaceDir',
  'workspace_dir',
  'project',
  'projectPath',
  'project_path',
  'projectDir',
  'project_dir',
  'repoPath',
  'repo_path',
  'repositoryPath',
  'repository_path',
] as const

const NESTED_KEYS = [
  'context',
  'metadata',
  'meta',
  'environment',
  'workspace',
  'project',
  'repository',
  'repo',
] as const

/**
 * 将数据源给出的绝对工作目录转成稳定的比较格式。
 * 不接受相对路径，避免把项目名称或来源文件名误当成本机目录。
 */
export function normalizeCollectedProjectPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  let candidate = value.trim()
  if (!candidate) return undefined

  if (/^file:\/\//i.test(candidate)) {
    try {
      candidate = fileURLToPath(candidate)
    } catch {
      return undefined
    }
  }
  if (!isAbsolute(candidate)) return undefined

  let normalized = normalize(resolve(candidate)).replace(/\\/g, '/')
  if (process.platform === 'win32') normalized = normalized.toLowerCase()
  if (normalized.length > 1 && !/^[a-z]:\/$/i.test(normalized)) {
    normalized = normalized.replace(/\/+$/, '')
  }
  return normalized || undefined
}

/** 从常见 Agent 元数据结构中提取真实工作目录，递归深度保持很小。 */
export function extractProjectPath(value: unknown, depth = 0): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 4) return undefined
  const record = value as Record<string, unknown>

  for (const key of DIRECT_PATH_KEYS) {
    const normalized = normalizeCollectedProjectPath(record[key])
    if (normalized) return normalized
  }
  for (const key of NESTED_KEYS) {
    const nested = extractProjectPath(record[key], depth + 1)
    if (nested) return nested
  }
  return undefined
}
