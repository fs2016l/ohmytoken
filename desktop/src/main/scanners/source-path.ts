import { resolve } from 'node:path'

/** 覆写目录可能嵌在旧目录内；同一个来源路径在一次扫描中只解析一次。 */
export function claimSourcePath(seen: Set<string>, file: string): boolean {
  const path = resolve(file)
  const key = process.platform === 'win32' ? path.toLowerCase() : path
  if (seen.has(key)) return false
  seen.add(key)
  return true
}
