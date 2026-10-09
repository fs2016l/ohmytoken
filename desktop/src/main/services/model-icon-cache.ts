import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { MAX_MODEL_ICON_BYTES, type ModelIconEntry } from '../../shared/model-icons'

export async function readVerifiedModelIcon(
  icon: ModelIconEntry,
  path: string,
): Promise<Buffer | null> {
  try {
    const info = await lstat(path)
    if (info.isFile() && info.size === icon.byteSize) {
      const bytes = await readFile(path)
      if (
        bytes.length === icon.byteSize &&
        createHash('sha256').update(bytes).digest('hex') === icon.sha256
      )
        return bytes
    }
  } catch {
    return null
  }
  await unlink(path).catch(() => undefined)
  return null
}

export async function downloadModelIcon(
  icon: ModelIconEntry,
  fetcher: typeof fetch = fetch,
): Promise<Buffer> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetcher(icon.url, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok || !response.body) throw new Error(`CDN HTTP ${response.status}`)
    if (Number(response.headers.get('content-length')) > icon.byteSize)
      throw new Error('CDN 图片超过清单大小')
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > icon.byteSize || size > MAX_MODEL_ICON_BYTES) {
        await reader.cancel()
        throw new Error('CDN 图片超过清单大小')
      }
      chunks.push(Buffer.from(value))
    }
    if (size !== icon.byteSize) throw new Error('CDN 图片大小与清单不符')
    const bytes = Buffer.concat(chunks, size)
    if (createHash('sha256').update(bytes).digest('hex') !== icon.sha256)
      throw new Error('CDN 图片 SHA-256 与清单不符')
    return bytes
  } finally {
    clearTimeout(timeout)
  }
}

export async function cacheModelIcon(
  icon: ModelIconEntry,
  path: string,
  fetcher: typeof fetch = fetch,
): Promise<'cached' | 'downloaded'> {
  if (await readVerifiedModelIcon(icon, path)) return 'cached'
  const bytes = await downloadModelIcon(icon, fetcher)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, bytes, { mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
  return 'downloaded'
}
