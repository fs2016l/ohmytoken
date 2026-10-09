import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  REPLAY_MAX_BYTES,
  REPLAY_MAX_CHUNK,
  validReplayOptions,
  validReplayExportOptions,
  replayFilename,
  type ReplayBegin,
  type ReplayFailure,
  type ReplayRecord,
} from '../../shared/replay'
import { createReplayFolder, REPLAY_RECORD_ID, validReplayFolderName } from './replay-folder-name'

interface WritingReplay {
  record: ReplayRecord
  file: FileHandle
  pending: Promise<void>
  closing: boolean
  bytes: number
  finishing?: Promise<ReplayRecord>
  cancelling?: Promise<void>
}
/** A separate, recoverable file store. Never changes scanned usage or its database. */
export class ReplayStore {
  private ready?: Promise<void>
  private active = new Map<string, WritingReplay>()
  private folders = new Map<string, string>()
  readonly directory: string
  constructor(directory: string) {
    this.directory = directory
  }

  private folderName(id: string): string {
    if (typeof id !== 'string' || !REPLAY_RECORD_ID.test(id)) throw new Error('invalid-id')
    return this.folders.get(id) ?? id
  }
  private folder(id: string): string {
    return join(this.directory, this.folderName(id))
  }
  private async load(id: string): Promise<ReplayRecord> {
    return this.loadFolder(this.folderName(id), id)
  }
  private async loadFolder(name: string, expectedId?: string): Promise<ReplayRecord> {
    if (!validReplayFolderName(name)) throw new Error('invalid-id')
    const filename = join(this.directory, name, 'record.json')
    if ((await fs.stat(filename)).size > 1024 * 1024) throw new Error('invalid-record')
    const record = JSON.parse(await fs.readFile(filename, 'utf8')) as ReplayRecord
    if (
      typeof record.id !== 'string' ||
      !REPLAY_RECORD_ID.test(record.id) ||
      (expectedId !== undefined && record.id !== expectedId) ||
      (record.folderName === undefined ? record.id !== name : record.folderName !== name) ||
      (this.folders.has(record.id) && this.folders.get(record.id) !== name) ||
      !validReplayOptions(record.options) ||
      !Number.isSafeInteger(record.createdAt) ||
      record.createdAt < 0 ||
      record.createdAt > 8640000000000000 ||
      !Number.isFinite(record.totalTokens) ||
      record.totalTokens < 0 ||
      (record.totalValue !== undefined &&
        (!Number.isFinite(record.totalValue) || record.totalValue < 0)) ||
      !Number.isSafeInteger(record.bytes) ||
      record.bytes < 0 ||
      record.bytes > REPLAY_MAX_BYTES ||
      (record.thumbnail != null &&
        (typeof record.thumbnail !== 'string' ||
          record.thumbnail.length > 512 * 1024 ||
          !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(record.thumbnail))) ||
      !['generating', 'complete', 'failed', 'cancelled'].includes(record.status)
    )
      throw new Error('invalid-record')
    this.folders.set(record.id, name)
    return record
  }
  private async save(record: ReplayRecord): Promise<void> {
    const folder = this.folder(record.id)
    const temp = join(folder, 'record.json.tmp')
    await fs.writeFile(temp, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 })
    await fs.rename(temp, join(folder, 'record.json'))
  }
  private initialize(): Promise<void> {
    return (this.ready ??= (async () => {
      await fs.mkdir(this.directory, { recursive: true })
      for (const entry of await fs.readdir(this.directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        try {
          const record = await this.loadFolder(entry.name)
          if (record.status === 'generating') {
            record.status = 'failed'
            record.failure = 'interrupted'
            await fs
              .unlink(join(this.folder(record.id), `${replayFilename(record.options)}.part`))
              .catch(() => {})
            await this.save(record)
          }
        } catch {
          /* An invalid folder must not hide the user's other exports. */
        }
      }
    })())
  }
  async list(): Promise<ReplayRecord[]> {
    await this.initialize()
    const records: ReplayRecord[] = []
    for (const entry of await fs.readdir(this.directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      try {
        records.push(await this.loadFolder(entry.name))
      } catch {
        /* Ignore incomplete metadata. */
      }
    }
    return records.sort((a, b) => b.createdAt - a.createdAt)
  }
  async begin(input: ReplayBegin): Promise<{ id: string }> {
    await this.initialize()
    if (
      !validReplayExportOptions(input?.options) ||
      !Number.isFinite(input.totalTokens) ||
      input.totalTokens < 0 ||
      (input.totalValue !== undefined &&
        (!Number.isFinite(input.totalValue) || input.totalValue < 0))
    )
      throw new Error('invalid-options')
    const record: ReplayRecord = {
      id: randomUUID(),
      createdAt: Date.now(),
      options: { ...input.options },
      totalTokens: input.totalTokens,
      totalValue: input.totalValue,
      status: 'generating',
      bytes: 0,
    }
    record.folderName = await createReplayFolder(this.directory, record.options, record.createdAt)
    this.folders.set(record.id, record.folderName)
    await this.save(record)
    try {
      const file = await fs.open(
        join(this.folder(record.id), `${replayFilename(record.options)}.part`),
        'wx',
        0o600,
      )
      this.active.set(record.id, {
        record,
        file,
        pending: Promise.resolve(),
        closing: false,
        bytes: 0,
      })
    } catch (error) {
      await this.save({ ...record, status: 'failed', failure: 'write' }).catch(() => {})
      throw error
    }
    return { id: record.id }
  }
  async write(id: string, position: number, data: Uint8Array): Promise<void> {
    const job = this.active.get(id)
    if (!job || job.closing) throw new Error('inactive-job')
    if (
      !(data instanceof Uint8Array) ||
      !data.byteLength ||
      data.byteLength > REPLAY_MAX_CHUNK ||
      !Number.isSafeInteger(position) ||
      position < 0 ||
      position + data.byteLength > REPLAY_MAX_BYTES
    )
      throw new Error('invalid-chunk')
    // Serial writes also make cancellation safe during a pending disk operation.
    job.pending = job.pending.then(async () => {
      let written = 0
      while (written < data.byteLength) {
        const result = await job.file.write(
          data,
          written,
          data.byteLength - written,
          position + written,
        )
        if (!result.bytesWritten) throw new Error('write-failed')
        written += result.bytesWritten
      }
      job.bytes = Math.max(job.bytes, position + data.byteLength)
    })
    await job.pending
  }
  async finish(id: string, thumbnail: string): Promise<ReplayRecord> {
    const job = this.active.get(id)
    if (!job || job.closing) throw new Error('inactive-job')
    job.closing = true
    job.finishing = this.finalize(job, thumbnail)
    return job.finishing
  }
  private async finalize(job: WritingReplay, thumbnail: string): Promise<ReplayRecord> {
    const id = job.record.id
    await job.pending
    await job.file.sync()
    await job.file.close()
    const filename = replayFilename(job.record.options)
    const part = join(this.folder(id), `${filename}.part`)
    await this.checkFile(part, { ...job.record, bytes: job.bytes })
    await fs.rename(part, join(this.folder(id), filename))
    const record: ReplayRecord = {
      ...job.record,
      status: 'complete',
      completedAt: Date.now(),
      bytes: job.bytes,
      thumbnail:
        typeof thumbnail === 'string' &&
        thumbnail.length <= 512 * 1024 &&
        /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(thumbnail)
          ? thumbnail
          : undefined,
    }
    await this.save(record)
    this.active.delete(id)
    return record
  }
  private async checkFile(part: string, record: ReplayRecord): Promise<void> {
    const check = await fs.open(part, 'r')
    try {
      const stat = await check.stat()
      if (
        !stat.isFile() ||
        stat.size !== record.bytes ||
        stat.size < 32 ||
        stat.size > REPLAY_MAX_BYTES
      )
        throw new Error('invalid-media')
      const header = Buffer.alloc(32)
      await check.read(header, 0, 32, 0)
      const format = record.options.format ?? 'mp4'
      const webp =
        header.toString('ascii', 0, 4) === 'RIFF' &&
        header.toString('ascii', 8, 12) === 'WEBP' &&
        header.readUInt32LE(4) + 8 === stat.size
      const animated = webp && header.toString('ascii', 12, 16) === 'VP8X' && !!(header[20] & 2)
      const valid =
        format === 'mp4'
          ? header.toString('ascii', 4, 8) === 'ftyp'
          : format === 'gif'
            ? ['GIF89a', 'GIF87a'].includes(header.toString('ascii', 0, 6))
            : format === 'png'
              ? header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              : format === 'jpeg'
                ? header[0] === 255 && header[1] === 216 && header[2] === 255
                : format === 'webp-animation'
                  ? animated
                  : webp && !animated
      if (!valid) throw new Error('invalid-media-format')
    } finally {
      await check.close()
    }
  }
  async cancel(id: string, failure?: ReplayFailure): Promise<void> {
    const job = this.active.get(id)
    if (!job) return
    job.cancelling ??= this.cancelJob(job, failure)
    await job.cancelling
  }
  private async cancelJob(job: WritingReplay, failure?: ReplayFailure): Promise<void> {
    const id = job.record.id
    job.closing = true
    // A reload while finalizing must not race two writers of the same metadata.
    if (job.finishing) {
      try {
        await job.finishing
        return
      } catch {
        /* Clean up the failed finalization below. */
      }
    }
    await job.pending.catch(() => {})
    await job.file.close().catch(() => {})
    const filename = replayFilename(job.record.options)
    await fs.unlink(join(this.folder(id), `${filename}.part`)).catch(() => {})
    await fs.unlink(join(this.folder(id), filename)).catch(() => {})
    try {
      await this.save({ ...job.record, status: failure ? 'failed' : 'cancelled', failure })
    } finally {
      this.active.delete(id)
    }
  }
  async filePath(id: string): Promise<string> {
    await this.initialize()
    const record = await this.load(id)
    if (record.status !== 'complete') throw new Error('incomplete-media')
    const file = join(this.folder(id), replayFilename(record.options))
    await this.checkFile(file, record)
    return file
  }
  async read(id: string): Promise<Uint8Array> {
    return fs.readFile(await this.filePath(id))
  }
  async remove(id: string): Promise<void> {
    await this.initialize()
    if (this.active.has(id)) throw new Error('active-job')
    const record = await this.load(id)
    // Only our own known files; exported copies chosen by the user are never removed.
    const filename = replayFilename(record.options)
    for (const name of [filename, `${filename}.part`, 'record.json.tmp', 'record.json']) {
      await fs.unlink(join(this.folder(id), name)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
    await fs.rmdir(this.folder(id))
    this.folders.delete(id)
  }
}

export interface ReplayDirectoryTarget {
  isPackaged: boolean
  platform: NodeJS.Platform
  execPath: string
  userData: string
}

/**
 * 回放历史目录：打包后放入软件安装目录（Windows/Linux 为可执行文件所在目录，
 * macOS 为 .app 所在目录——写进 bundle 会破坏签名与公证）；开发态没有安装目录，
 * 沿用 userData。安装目录是否可写由调用方探测，不可写时自行回退 userData。
 */
export function replayStorageDirectory(target: ReplayDirectoryTarget): string {
  if (!target.isPackaged) return join(target.userData, 'replays')
  const installDirectory =
    target.platform === 'darwin'
      ? // execPath 为 <安装位置>/ohmytoken.app/Contents/MacOS/ohmytoken，取包含 .app 的目录。
        dirname(dirname(dirname(dirname(target.execPath))))
      : dirname(target.execPath)
  return join(installDirectory, 'replays')
}
