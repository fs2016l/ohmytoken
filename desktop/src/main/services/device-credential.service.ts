import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * 设备凭证的本地存储：safeStorage 加密落盘，与登录会话同一套安全模式。
 * safeStorage 不可用时凭证只保存在内存中，应用重启后重新登记即可无感恢复。
 */
const CREDENTIAL_FILE_MAGIC = 'DVC1:'

export interface StoredDeviceCredential {
  credential: string
  /** 本地按接收时间折算的绝对过期时刻（epoch ms）。 */
  expiresAt: number
  /** 服务端下发的空闲有效期（秒），用于计算续期提前量。 */
  ttlSeconds: number
}

let memoryCredential: StoredDeviceCredential | null = null

function getCredentialFile(): string {
  return join(app.getPath('userData'), 'device-credential.enc')
}

function isStoredCredential(value: unknown): value is StoredDeviceCredential {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StoredDeviceCredential>
  return (
    typeof candidate.credential === 'string' &&
    candidate.credential.length > 0 &&
    typeof candidate.expiresAt === 'number' &&
    Number.isFinite(candidate.expiresAt) &&
    typeof candidate.ttlSeconds === 'number' &&
    Number.isFinite(candidate.ttlSeconds) &&
    candidate.ttlSeconds > 0
  )
}

export function saveDeviceCredential(issued: {
  credential: string
  expiresIn: number
}): StoredDeviceCredential {
  const record: StoredDeviceCredential = {
    credential: issued.credential,
    expiresAt: Date.now() + issued.expiresIn * 1000,
    ttlSeconds: issued.expiresIn,
  }
  memoryCredential = record
  persistCredential(record)
  return { ...record }
}

function persistCredential(record: StoredDeviceCredential): void {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[device-credential] safeStorage 不可用，凭证仅保存在内存中，应用重启后重新登记')
    return
  }
  const file = getCredentialFile()
  const tempFile = file + '.tmp'
  try {
    const encrypted = safeStorage.encryptString(JSON.stringify(record))
    writeFileSync(tempFile, Buffer.concat([Buffer.from(CREDENTIAL_FILE_MAGIC, 'utf8'), encrypted]))
    renameSync(tempFile, file)
  } catch (error) {
    console.error('[device-credential] 加密保存凭证失败，凭证仅在本次运行有效:', error)
    try {
      if (existsSync(tempFile)) unlinkSync(tempFile)
    } catch {
      void 0
    }
  }
}

export function loadDeviceCredential(): StoredDeviceCredential | null {
  if (memoryCredential) return { ...memoryCredential }
  const file = getCredentialFile()
  if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return null
  try {
    const data = readFileSync(file)
    const prefixLength = Buffer.byteLength(CREDENTIAL_FILE_MAGIC)
    if (data.subarray(0, prefixLength).toString('utf8') !== CREDENTIAL_FILE_MAGIC) {
      throw new Error('凭证文件格式不正确')
    }
    const parsed = JSON.parse(safeStorage.decryptString(data.subarray(prefixLength))) as unknown
    if (!isStoredCredential(parsed)) throw new Error('凭证字段不完整')
    memoryCredential = parsed
    return { ...parsed }
  } catch (error) {
    console.warn('[device-credential] 读取加密凭证失败:', error)
    clearDeviceCredential()
    return null
  }
}

export function clearDeviceCredential(): void {
  memoryCredential = null
  const files = [getCredentialFile(), getCredentialFile() + '.tmp']
  for (const file of files) {
    if (!existsSync(file)) continue
    try {
      unlinkSync(file)
    } catch (error) {
      console.error('[device-credential] 删除凭证文件失败:', error)
    }
  }
}

/** 当前仍有效的凭证；缺失、为空或剩余有效期不足 minimumValidityMs 时返回 null。 */
export function currentDeviceCredential(minimumValidityMs = 30_000): string | null {
  const record = loadDeviceCredential()
  if (!record || record.credential.length === 0) return null
  if (record.expiresAt - Date.now() <= minimumValidityMs) return null
  return record.credential
}

/** 剩余有效期不足 20% 或不足 60 秒时应当后台换新。 */
export function shouldRotateDeviceCredential(): boolean {
  const record = loadDeviceCredential()
  if (!record) return true
  const remainingMs = record.expiresAt - Date.now()
  return remainingMs <= Math.max(60_000, record.ttlSeconds * 200)
}
