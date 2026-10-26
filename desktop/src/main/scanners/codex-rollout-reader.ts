import { ZstdFrameValidator } from '../lib/zstd-frame-validator'
import { closeSync, openSync, readSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { createZstdDecompress } from 'node:zlib'
import type { Transform } from 'node:stream'
import type { TextLine } from '../lib/line-reader'

export interface CodexTextLine extends TextLine {
  /** 长行只解码结构骨架；检查点仍按原始行开头校验。 */
  prefix?: string
}

const READ_CHUNK_BYTES = 1024 * 1024
const DECOMPRESS_CHUNK_BYTES = 4 * 1024 * 1024
const BATCH_LINES = 512
/** 截断行只用于检查点，保留足够的开头字节即可。 */
const PREFIX_BYTES = 512
/** 超过该长度的大正文行改为解码骨架：省略超长字符串值，保留键、结构和短字段。 */
const SKELETON_LINE_BYTES = 64 * 1024
const SKELETON_STRING_BYTES = 16 * 1024
const CARRY_MIN_BYTES = 64 * 1024
// 只对解析时仅读取类型、标识、时间戳的大正文记录生成骨架；会话元数据、
// 轮次上下文和用户消息等可能读取长字符串（如标题）的记录仍完整解码。
const SKELETON_HEAD =
  /^\{"timestamp":"[^"]*",(?:"ordinal":\d+,)?"type":"(response_item|compacted|world_state|event_msg)"(?:,"payload":\{"type":"([A-Za-z_]+)")?/
const SKELETON_EVENTS = new Set([
  'item_completed',
  'exec_command_end',
  'patch_apply_end',
  'mcp_tool_call_end',
  'dynamic_tool_call_response',
])

// Electron 运行时分配、回收大块 ArrayBuffer 的代价远高于 Node（单个可达毫秒级），
// 且在整个进程内串行；读取缓冲区和跨块行缓冲区在线程内复用，不按读取块或按行新建。
const spareBuffers: Buffer[] = []
const EMPTY = Buffer.alloc(0)

function leaseBuffer(bytes: number): Buffer {
  const index = spareBuffers.findIndex((buffer) => buffer.length >= bytes)
  return index >= 0 ? spareBuffers.splice(index, 1)[0] : Buffer.allocUnsafe(bytes)
}

function releaseBuffer(buffer: Buffer | null): void {
  if (buffer && spareBuffers.length < 4) spareBuffers.push(buffer)
}

/** 压缩日志的偏移按解压后字节计算；分批交给解析器，避免逐行异步调度。 */
export async function* readCodexLineBatches(
  file: string,
  startOffset: number,
  maxLineBytes: number,
): AsyncGenerator<CodexTextLine[]> {
  if (!file.endsWith('.jsonl.zst')) {
    const lines = new CodexLineSplitter(maxLineBytes, startOffset)
    const fd = openSync(file, 'r')
    const buffer = leaseBuffer(READ_CHUNK_BYTES)
    let batch: CodexTextLine[] = []
    try {
      for (let position = Math.max(0, Math.floor(startOffset)); ;) {
        const bytesRead = readSync(fd, buffer, 0, READ_CHUNK_BYTES, position)
        if (bytesRead <= 0) break
        position += bytesRead
        // push 返回前已把未完成的行复制到行缓冲区，读取缓冲区可直接复用。
        for (const line of lines.push(buffer.subarray(0, bytesRead))) {
          batch.push(line)
          if (batch.length >= BATCH_LINES) {
            yield batch
            batch = []
          }
        }
      }
      const tail = lines.finish()
      if (tail) batch.push(tail)
      if (batch.length) yield batch
    } finally {
      closeSync(fd)
      lines.dispose()
      releaseBuffer(buffer)
    }
    return
  }
  // zstd 不能按解压后的偏移直接 seek；压缩归档从头读取，仍按事件时间筛选。
  if (startOffset !== 0) throw new Error('Codex 压缩日志不支持字节断点读取')
  const decompressor = createZstdDecompress({ chunkSize: DECOMPRESS_CHUNK_BYTES })
  const feeding = feedZstd(file, decompressor)
  const lines = new CodexLineSplitter(maxLineBytes)
  try {
    for await (const chunk of decompressor) {
      const batch = lines.push(chunk as Buffer)
      if (batch.length) yield batch
    }
    await feeding
    const tail = lines.finish()
    if (tail) yield [tail]
  } finally {
    decompressor.destroy()
    await feeding
    lines.dispose()
  }
}

/**
 * 用复用的缓冲区读取压缩文件，按帧边界写入解压器；一块被完全消费后再读下一块。
 * 错误通过销毁解压器交给读取方，本函数自身不会拒绝。
 */
async function feedZstd(file: string, decompressor: Transform): Promise<void> {
  const frames = new ZstdFrameValidator()
  let fd: number | null = null
  let input: Buffer | null = null
  let completed = false
  try {
    fd = openSync(file, 'r')
    input = leaseBuffer(READ_CHUNK_BYTES)
    for (let position = 0; ;) {
      const bytesRead = readSync(fd, input, 0, READ_CHUNK_BYTES, position)
      if (bytesRead <= 0) break
      position += bytesRead
      // 原生解压器遇到不产生输出的帧时可能提前结束当前输入块；
      // 按帧边界拆开写入，避免同一块中随后的日志被静默忽略。
      const segments: Buffer[] = []
      frames.push(input.subarray(0, bytesRead), (segment) => segments.push(segment))
      for (const [index, segment] of segments.entries()) {
        if (index < segments.length - 1) decompressor.write(segment)
        else await written(decompressor, segment)
      }
    }
    frames.finish()
    decompressor.end()
    completed = true
  } catch (error) {
    decompressor.destroy(error instanceof Error ? error : new Error(String(error)))
  } finally {
    if (fd !== null) closeSync(fd)
    // 中途停止时原生解压可能仍在读取输入块，不放回复用。
    if (completed) releaseBuffer(input)
  }
}

function written(stream: Transform, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const closed = (): void => reject(new Error('Codex 压缩日志读取已停止'))
    stream.once('close', closed)
    stream.write(chunk, (error) => {
      stream.off('close', closed)
      if (error) reject(error)
      else resolve()
    })
  })
}

/**
 * 按字节切分行，偏移与截断语义和 readUtf8Lines 一致。超过上限的行只保留开头；
 * 大正文行省略超长字符串后再解码，避免把截图、工具输出等整段转成字符串。
 * push 不保留传入块的引用：完整落在块内的行直接解码，跨块的行复制到复用的行缓冲区。
 */
class CodexLineSplitter {
  private carry: Buffer | null = null
  private kept = 0
  private lineBytes = 0
  private offset: number
  private index = 0
  private readonly limit: number

  constructor(limit: number, startOffset = 0) {
    this.limit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Number.POSITIVE_INFINITY
    this.offset = Math.max(0, Math.floor(startOffset))
  }

  push(chunk: Buffer): CodexTextLine[] {
    const lines: CodexTextLine[] = []
    let start = 0
    while (start < chunk.length) {
      const newline = chunk.indexOf(0x0a, start)
      if (newline < 0) {
        this.append(chunk, start, chunk.length)
        break
      }
      if (this.lineBytes === 0) {
        const lineBytes = newline - start
        const end = lineBytes > this.limit ? start + Math.min(this.limit, PREFIX_BYTES) : newline
        lines.push(this.line(chunk.subarray(start, end), lineBytes, true))
      } else {
        this.append(chunk, start, newline)
        lines.push(this.line(this.pending(), this.lineBytes, true))
      }
      start = newline + 1
    }
    return lines
  }

  finish(): CodexTextLine | null {
    return this.lineBytes > 0 ? this.line(this.pending(), this.lineBytes, false) : null
  }

  dispose(): void {
    releaseBuffer(this.carry)
    this.carry = null
  }

  private pending(): Buffer {
    return this.carry ? this.carry.subarray(0, this.kept) : EMPTY
  }

  private append(chunk: Buffer, from: number, to: number): void {
    this.lineBytes += to - from
    // 超过上限的行不会被解析，只保留检查点需要的开头。
    const cap = this.lineBytes > this.limit ? Math.min(this.limit, PREFIX_BYTES) : this.lineBytes
    if (this.kept > cap) this.kept = cap
    const take = Math.min(to - from, cap - this.kept)
    if (take <= 0) return
    if (!this.carry || this.carry.length < this.kept + take) {
      const grown = leaseBuffer(
        Math.max(this.kept + take, CARRY_MIN_BYTES, (this.carry?.length ?? 0) * 2),
      )
      if (this.carry) this.carry.copy(grown, 0, 0, this.kept)
      releaseBuffer(this.carry)
      this.carry = grown
    }
    chunk.copy(this.carry, this.kept, from, from + take)
    this.kept += take
  }

  private line(raw: Buffer, lineBytes: number, terminated: boolean): CodexTextLine {
    const truncated = lineBytes > this.limit
    let line: string
    let prefix: string | undefined
    if (truncated) {
      line = decodeAll(raw)
    } else {
      const skeleton = terminated && raw.length > SKELETON_LINE_BYTES ? codexSkeleton(raw) : null
      if (skeleton !== null) prefix = new StringDecoder('utf8').write(raw.subarray(0, PREFIX_BYTES))
      line = skeleton ?? decodeAll(raw)
      if (line.endsWith('\r')) line = line.slice(0, -1)
    }
    const byteLength = lineBytes + (terminated ? 1 : 0)
    const result: CodexTextLine = {
      line,
      lineIndex: this.index++,
      byteOffset: this.offset,
      byteLength,
      truncated,
      terminated,
      ...(prefix === undefined ? {} : { prefix }),
    }
    this.offset += byteLength
    this.kept = 0
    this.lineBytes = 0
    return result
  }
}

function decodeAll(bytes: Buffer): string {
  const decoder = new StringDecoder('utf8')
  return decoder.write(bytes) + decoder.end()
}

/**
 * JSON 字符串中的引号必须转义，因此在字符串之外遇到的下一个引号就是字符串起点。
 * 省略超长字符串的内容，保留其余字节；类型识别的正则和解析读取的短字段都不受影响。
 * 切分点都是 ASCII 引号，各段分别解码与整体解码结果一致，不必拼接新缓冲区。
 */
function codexSkeleton(raw: Buffer): string | null {
  const head = SKELETON_HEAD.exec(raw.toString('latin1', 0, PREFIX_BYTES))
  if (!head) return null
  if (head[1] === 'event_msg' && !SKELETON_EVENTS.has(head[2] ?? '')) return null
  const parts: string[] = []
  let keepFrom = 0
  let position = 0
  while (true) {
    const open = raw.indexOf(0x22, position)
    if (open < 0) break
    let close = open + 1
    while (true) {
      close = raw.indexOf(0x22, close)
      if (close < 0) return null
      let slashes = 0
      while (raw[close - 1 - slashes] === 0x5c) slashes++
      if (slashes % 2 === 0) break
      close++
    }
    if (close - open - 1 > SKELETON_STRING_BYTES) {
      parts.push(decodeAll(raw.subarray(keepFrom, open + 1)))
      keepFrom = close
    }
    position = close + 1
  }
  if (!parts.length) return null
  parts.push(decodeAll(raw.subarray(keepFrom)))
  return parts.join('')
}
