import { closeSync, fstatSync, openSync, readSync } from 'fs'
import { StringDecoder } from 'string_decoder'
import { zstdDecompressSync } from 'zlib'

const FRAME_MAGIC = 0xfd2fb528
const MAX_FRAME_BYTES = 128 * 1024 * 1024

/**
 * 遍历追加式 Zstandard JSONL。Node 的一次解压只处理首帧，必须逐帧读取。
 * 仅保留当前帧和跨帧的未结束行；未写完的末帧留给下次扫描，损坏完整帧报错。
 */
export function* readZstdLines(file: string): Generator<string> {
  const fd = openSync(file, 'r')
  const decoder = new StringDecoder('utf8')
  let pending = ''
  try {
    const size = fstatSync(fd).size
    for (let position = 0; position < size;) {
      const end = frameEnd(fd, position, size)
      if (end === null) break
      const length = end - position
      if (length > MAX_FRAME_BYTES) throw new Error('Zstandard 会话帧超过读取上限')
      const frame = readBytes(fd, position, length)
      const text =
        pending + decoder.write(zstdDecompressSync(frame, { maxOutputLength: MAX_FRAME_BYTES }))
      const lines = text.split('\n')
      pending = lines.pop() ?? ''
      if (Buffer.byteLength(pending) > MAX_FRAME_BYTES)
        throw new Error('Zstandard 会话行超过读取上限')
      for (const line of lines) yield line.endsWith('\r') ? line.slice(0, -1) : line
      position = end
    }
    // Durable JSONL 行以换行结束；不解析跨写入的半行。
  } finally {
    closeSync(fd)
  }
}

/** 根据帧头和块头定位完整帧，不解压历史文件或依赖 Node 私有绑定。 */
function frameEnd(fd: number, start: number, size: number): number | null {
  if (size - start < 4) return null
  const magic = readBytes(fd, start, 4).readUInt32LE()
  if ((magic & 0xfffffff0) === 0x184d2a50) {
    if (size - start < 8) return null
    const end = start + 8 + readBytes(fd, start + 4, 4).readUInt32LE()
    return end <= size ? end : null
  }
  if (magic !== FRAME_MAGIC) throw new Error(`Zstandard 帧标识损坏 (${start})`)
  if (size - start < 5) return null
  const flags = readBytes(fd, start + 4, 1)[0]
  if (flags & 0x18) throw new Error(`Zstandard 帧头含保留位 (${start})`)
  const singleSegment = Boolean(flags & 0x20)
  const sizeFlag = flags >>> 6
  const contentBytes = sizeFlag ? 2 ** sizeFlag : singleSegment ? 1 : 0
  const dictionaryBytes = [0, 1, 2, 4][flags & 3]
  let position = start + 5 + (singleSegment ? 0 : 1) + dictionaryBytes + contentBytes
  if (position > size) return null
  while (true) {
    if (size - position < 3) return null
    const block = readBytes(fd, position, 3).readUIntLE(0, 3)
    const kind = (block >>> 1) & 3
    if (kind === 3) throw new Error(`Zstandard 块类型损坏 (${position})`)
    position += 3 + (kind === 1 ? 1 : block >>> 3)
    if (position > size) return null
    if (block & 1) break
  }
  if (flags & 4) position += 4
  return position <= size ? position : null
}

function readBytes(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.allocUnsafe(length)
  let count = 0
  while (count < length) {
    const read = readSync(fd, buffer, count, length - count, position + count)
    if (!read) throw new Error('Zstandard 会话文件在读取期间缩短')
    count += read
  }
  return buffer
}
