import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { UpdateAsset, UpdateState } from '../../shared/updater'

interface Checkpoint {
  schema: 1
  asset: UpdateAsset
  etag?: string
  lastModified?: string
  updatedAt: number
}

interface DownloadOptions {
  directory: string
  fetch: typeof globalThis.fetch
  onState: (state: UpdateState) => void
  headers?: Record<string, string>
  retryDelays?: number[]
  idleTimeoutMs?: number
}

class DownloadError extends Error {
  retryable: boolean
  constructor(message: string, retryable = false) {
    super(message)
    this.retryable = retryable
  }
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export function validateUpdateAsset(asset: UpdateAsset): void {
  if (
    !asset ||
    !/^\d+\.\d+\.\d+$/.test(asset.version) ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    !/^[\w.-]+\.(exe|zip)$/.test(asset.fileName) ||
    typeof asset.sha512 !== 'string' ||
    Buffer.from(asset.sha512, 'base64').length !== 64 ||
    Buffer.from(asset.sha512, 'base64').toString('base64') !== asset.sha512 ||
    !['win32', 'darwin'].includes(asset.platform) ||
    !['x64', 'arm64'].includes(asset.arch)
  ) {
    throw new DownloadError('Invalid update metadata / 更新包信息无效')
  }
  for (const value of [asset.url, asset.feedUrl]) {
    const url = new URL(value)
    if (
      url.username ||
      url.password ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    ) {
      throw new DownloadError('Invalid update URL / 更新地址无效')
    }
  }
}

function sameAsset(a: UpdateAsset, b: UpdateAsset): boolean {
  return (
    a.version === b.version &&
    a.sha512 === b.sha512 &&
    a.size === b.size &&
    a.fileName === b.fileName &&
    a.feedUrl === b.feedUrl &&
    a.platform === b.platform &&
    a.arch === b.arch
  )
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

/** One persistent full-installer download. No checkpoint or partial file is stored in COS. */
export class ResumableUpdateDownload {
  private options: DownloadOptions
  private checkpoint: Checkpoint | null = null
  private initialization: Promise<void> | null = null
  private active: Promise<string | null> | null = null
  private controller: AbortController | null = null
  private state: UpdateState = { status: 'idle', info: null, progress: null, error: null }
  readonly partPath: string
  private metadataPath: string

  constructor(options: DownloadOptions) {
    this.options = options
    this.partPath = join(options.directory, 'installer.part')
    this.metadataPath = join(options.directory, 'checkpoint.json')
  }

  get asset(): UpdateAsset | null {
    return this.checkpoint ? { ...this.checkpoint.asset } : null
  }

  async snapshot(): Promise<UpdateState> {
    await this.initialize()
    return structuredClone(this.state)
  }

  private publish(
    status: UpdateState['status'],
    transferred: number,
    error: string | null = null,
    bytesPerSecond = 0,
  ): void {
    const asset = this.checkpoint?.asset
    this.state = {
      status,
      info: asset
        ? {
            version: asset.version,
            releaseDate: asset.releaseDate,
            releaseNotes: asset.releaseNotes,
          }
        : null,
      progress: asset
        ? {
            percent: (100 * transferred) / asset.size,
            transferred,
            total: asset.size,
            bytesPerSecond,
          }
        : null,
      error,
    }
    this.options.onState(structuredClone(this.state))
  }

  private initialize(): Promise<void> {
    this.initialization ??= this.restore()
    return this.initialization
  }

  private async restore(): Promise<void> {
    await mkdir(this.options.directory, { recursive: true })
    let saved: Checkpoint
    try {
      saved = JSON.parse(await readFile(this.metadataPath, 'utf8')) as Checkpoint
      if (saved.schema !== 1 || !Number.isFinite(saved.updatedAt))
        throw new Error('Invalid checkpoint')
      validateUpdateAsset(saved.asset)
      if (saved.etag !== undefined && (typeof saved.etag !== 'string' || /[\r\n]/.test(saved.etag)))
        throw new Error('Invalid validator')
      if (
        saved.lastModified !== undefined &&
        (typeof saved.lastModified !== 'string' || /[\r\n]/.test(saved.lastModified))
      )
        throw new Error('Invalid validator')
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code && !isMissing(error)) throw error
      await this.removeFiles()
      return
    }
    const partial = await stat(this.partPath).catch((error) => {
      if (isMissing(error)) return null
      throw error
    })
    if (
      !partial ||
      !partial.isFile() ||
      partial.size > saved.asset.size ||
      Date.now() - Math.max(saved.updatedAt, partial.mtimeMs) > RETENTION_MS
    ) {
      await this.removeFiles()
      return
    }
    this.checkpoint = saved
    // Restart never resumes the network automatically, including a fully downloaded partial.
    this.publish('paused', partial.size)
  }

  private async persist(): Promise<void> {
    if (!this.checkpoint) return
    this.checkpoint.updatedAt = Date.now()
    const temporary = this.metadataPath + '.tmp'
    await writeFile(temporary, JSON.stringify(this.checkpoint), { mode: 0o600 })
    await rename(temporary, this.metadataPath)
  }

  private async removeFiles(): Promise<void> {
    for (const path of [this.partPath, this.metadataPath, this.metadataPath + '.tmp']) {
      await rm(path, { force: true })
    }
  }

  async discard(): Promise<void> {
    await this.pause()
    await this.initialize()
    await this.removeFiles()
    this.checkpoint = null
    this.publish('idle', 0)
  }

  download(asset: UpdateAsset): Promise<string | null> {
    if (this.active) return this.active
    this.controller = new AbortController()
    this.active = this.run(asset, this.controller.signal).finally(() => {
      this.active = null
      this.controller = null
    })
    return this.active
  }

  async pause(): Promise<void> {
    this.controller?.abort()
    await this.active
  }

  private async bytesOnDisk(): Promise<number> {
    return stat(this.partPath)
      .then((value) => value.size)
      .catch((error) => {
        if (isMissing(error)) return 0
        throw error
      })
  }

  private async resetPartial(): Promise<void> {
    await rm(this.partPath, { force: true })
    if (this.checkpoint) {
      delete this.checkpoint.etag
      delete this.checkpoint.lastModified
      await this.persist()
    }
    this.publish('downloading', 0)
  }

  private async run(asset: UpdateAsset, signal: AbortSignal): Promise<string | null> {
    try {
      await this.initialize()
      validateUpdateAsset(asset)
      if (!this.checkpoint || !sameAsset(this.checkpoint.asset, asset)) {
        await this.removeFiles()
        this.checkpoint = { schema: 1, asset: { ...asset }, updatedAt: Date.now() }
        await this.persist()
      }
      // Keep the original tracking UUID on retries and restarts to avoid duplicate statistics.
      const delays = this.options.retryDelays ?? [2000, 5000, 10000, 30000]
      let failures = 0
      let resetAfter416 = false
      let forbiddenRetries = 0
      while (!signal.aborted) {
        const offset = await this.bytesOnDisk()
        this.publish('downloading', offset)
        try {
          if (offset < asset.size) {
            const outcome = await this.transfer(offset, signal)
            if (outcome === 'reset') {
              if (resetAfter416) throw new DownloadError('Invalid download range / 下载范围无效')
              resetAfter416 = true
              await this.resetPartial()
              continue
            }
          }
          signal.throwIfAborted()
          this.publish('verifying', await this.bytesOnDisk())
          const digest = createHash('sha512')
          for await (const chunk of createReadStream(this.partPath, { signal }))
            digest.update(chunk)
          if (
            (await this.bytesOnDisk()) !== asset.size ||
            digest.digest('base64') !== asset.sha512
          ) {
            await this.resetPartial()
            throw new DownloadError(
              'Update checksum mismatch; please retry / 更新包校验失败，请重试',
            )
          }
          await this.persist()
          return this.partPath
        } catch (error) {
          if (signal.aborted) break
          if (error instanceof DownloadError && !error.retryable) throw error
          if ((error as Error)?.message === 'HTTP 403' && ++forbiddenRetries > 1) {
            throw new DownloadError('Update access denied / 更新下载授权失败')
          }
          // Disk failures need user action; never turn them into endless network retries.
          const code = (error as NodeJS.ErrnoException)?.code
          if (
            typeof code === 'string' &&
            !/^(ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|UND_ERR_|ABORT_ERR)/.test(code)
          )
            throw error
          await this.persist()
          this.publish('waiting-network', await this.bytesOnDisk())
          await new Promise<void>((resolve) => {
            const finish = (): void => {
              clearTimeout(timer)
              signal.removeEventListener('abort', finish)
              resolve()
            }
            const timer = setTimeout(
              finish,
              delays[Math.min(failures++, delays.length - 1)] ?? 30000,
            )
            signal.addEventListener('abort', finish, { once: true })
            if (signal.aborted) finish()
          })
        }
      }
      await this.persist()
      this.publish('paused', await this.bytesOnDisk())
      return null
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      const message =
        error instanceof DownloadError
          ? error.message
          : `Unable to save update / 无法保存更新包${code ? ` (${code})` : ''}`
      this.publish('error', await this.bytesOnDisk().catch(() => 0), message)
      throw new Error(message, { cause: error })
    }
  }

  private async transfer(offset: number, signal: AbortSignal): Promise<'done' | 'reset'> {
    const checkpoint = this.checkpoint!
    const timeout = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const touch = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => timeout.abort(), this.options.idleTimeoutMs ?? 30000)
    }
    touch()
    let response: Response | undefined
    try {
      const headers: Record<string, string> = {
        ...this.options.headers,
        'Cache-Control': 'no-cache',
        'Accept-Encoding': 'identity',
      }
      if (offset > 0) {
        headers.Range = `bytes=${offset}-`
        if (checkpoint.etag && !checkpoint.etag.startsWith('W/'))
          headers['If-Range'] = checkpoint.etag
        else if (checkpoint.lastModified) headers['If-Range'] = checkpoint.lastModified
      }
      // Always begin at the stable application URL: its redirect renews the CDN signature.
      response = await this.options.fetch(checkpoint.asset.url, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.any([signal, timeout.signal]),
      })
      if (response.status === 416) return 'reset'
      if (!response.ok) {
        throw new DownloadError(
          `HTTP ${response.status}`,
          [403, 408, 429, 500, 502, 503, 504].includes(response.status),
        )
      }
      if (!response.body || ![200, 206].includes(response.status))
        throw new DownloadError('Invalid download response / 下载响应无效')
      const encoding = response.headers.get('content-encoding')
      if (encoding && encoding !== 'identity')
        throw new DownloadError('Compressed update response / 更新包响应被压缩')
      const etag = response.headers.get('etag') ?? undefined
      const lastModified = response.headers.get('last-modified') ?? undefined
      let start = 0
      let end = checkpoint.asset.size - 1
      if (response.status === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
        if (
          !range ||
          Number(range[1]) !== offset ||
          Number(range[3]) !== checkpoint.asset.size ||
          Number(range[2]) < offset ||
          Number(range[2]) >= checkpoint.asset.size
        ) {
          throw new DownloadError('Invalid download range / 下载范围无效')
        }
        if (
          offset > 0 &&
          ((checkpoint.etag && etag && checkpoint.etag !== etag) ||
            (!checkpoint.etag &&
              checkpoint.lastModified &&
              lastModified &&
              checkpoint.lastModified !== lastModified))
        )
          return 'reset'
        start = offset
        end = Number(range[2])
      }
      const length = response.headers.get('content-length')
      if (length !== null && Number(length) !== end - start + 1)
        throw new DownloadError('Invalid update size / 更新包大小无效')
      // A server ignoring Range sends 200: truncate before writing, never append a full file.
      const file = await open(this.partPath, start === 0 ? 'w' : 'a', 0o600)
      let received = start
      let lastTime = Date.now()
      let lastBytes = start
      try {
        checkpoint.etag = etag
        checkpoint.lastModified = lastModified
        await this.persist()
        this.publish('downloading', received)
        const reader = response.body.getReader()
        try {
          for (;;) {
            touch()
            const { value, done } = await reader.read()
            if (done) break
            signal.throwIfAborted()
            if (received + value.length > end + 1)
              throw new DownloadError('Update exceeds expected size / 更新包超出预期大小')
            let written = 0
            while (written < value.length) {
              const result = await file.write(value, written, value.length - written)
              if (result.bytesWritten === 0)
                throw new DownloadError('Unable to write update / 无法写入更新包')
              written += result.bytesWritten
            }
            received += value.length
            const now = Date.now()
            if (now - lastTime >= 200 || received === checkpoint.asset.size) {
              this.publish(
                'downloading',
                received,
                null,
                ((received - lastBytes) * 1000) / Math.max(1, now - lastTime),
              )
              lastTime = now
              lastBytes = received
            }
          }
        } finally {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
        if (received !== end + 1 || received !== checkpoint.asset.size)
          throw new DownloadError('Download interrupted', true)
        return 'done'
      } finally {
        try {
          await file.sync()
        } finally {
          await file.close()
        }
      }
    } finally {
      clearTimeout(timer!)
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {})
    }
  }
}
