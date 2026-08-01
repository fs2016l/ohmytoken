import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
let cachedDeviceId: string | null = null

function getDeviceFile(): string {
  return join(app.getPath('userData'), 'device-id.txt')
}

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId
  const file = getDeviceFile()

  if (existsSync(file)) {
    try {
      const id = readFileSync(file, 'utf-8').trim().toLowerCase()
      if (UUID_V4_PATTERN.test(id)) {
        cachedDeviceId = id
        return id
      }
      console.warn('[device-id] 文件内容不是 UUIDv4，将重新生成')
    } catch (e) {
      console.warn(`[device-id] 读取文件失败，将重新生成: ${(e as Error).message}`)
    }
  }

  const newId = randomUUID()
  cachedDeviceId = newId
  try {
    writeFileSync(file, newId, 'utf-8')
  } catch (e) {
    console.warn(`[device-id] 写入文件失败（本次进程内有效）: ${(e as Error).message}`)
  }
  return cachedDeviceId
}
