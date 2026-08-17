import { app } from 'electron'
import { mkdir, open, readFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { lock } from 'proper-lockfile'

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LOCK_STALE_MS = 10_000
let cachedDeviceId: string | null = null
let resolvingDeviceId: Promise<string> | null = null

function getDeviceFile(): string {
  return join(app.getPath('userData'), 'device-id.txt')
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function readPersistedDeviceId(file: string): Promise<string | null> {
  let contents: string
  try {
    contents = await readFile(file, 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) return null
    throw error
  }

  const id = contents.trim().toLowerCase()
  if (!id) return null
  if (UUID_V4_PATTERN.test(id)) return id

  console.warn('[device-id] 文件内容不是 UUIDv4，将重新生成并持久化')
  return null
}

async function persistDeviceId(file: string, deviceId: string): Promise<void> {
  const handle = await open(file, 'w', 0o600)
  try {
    await handle.writeFile(deviceId, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function resolveDeviceId(): Promise<string> {
  const file = getDeviceFile()
  await mkdir(app.getPath('userData'), { recursive: true })

  // proper-lockfile 默认要求目标文件存在；先创建空文件，再在锁内重新读取，
  // 这样多个进程首次启动时也只会持久化同一个 UUID。
  const seedHandle = await open(file, 'a', 0o600)
  await seedHandle.close()

  const release = await lock(file, {
    stale: LOCK_STALE_MS,
    update: LOCK_STALE_MS / 2,
    retries: {
      retries: 10,
      factor: 1.5,
      minTimeout: 25,
      maxTimeout: 250,
      randomize: true,
    },
  })
  try {
    const existing = await readPersistedDeviceId(file)
    if (existing) return existing

    const generated = randomUUID()
    await persistDeviceId(file, generated)
    return generated
  } finally {
    await release()
  }
}

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId
  if (!resolvingDeviceId) {
    resolvingDeviceId = resolveDeviceId()
      .then((deviceId) => {
        cachedDeviceId = deviceId
        return deviceId
      })
      .finally(() => {
        resolvingDeviceId = null
      })
  }
  return resolvingDeviceId
}
