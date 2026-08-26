import { closeSync, openSync, readSync } from 'fs'
import { StringDecoder } from 'string_decoder'

export interface TextLine {
  line: string
  /** 从 0 开始的行号；断点读取时仅保证本次遍历内递增。 */
  lineIndex: number
  /** 该行在文件中的绝对字节偏移。 */
  byteOffset: number
  /** 该行消耗的字节数（包含换行符）。 */
  byteLength: number
  /** 内容超过上限时只保留前缀，字节位置仍按完整行计算。 */
  truncated?: boolean
}

/**
 * 以固定块、低内存遍历 UTF-8 文本行。
 * startOffset 必须位于行边界；byteOffset 始终是文件绝对偏移。
 */
export function* readUtf8Lines(
  file: string,
  chunkSize = 256 * 1024,
  startOffset = 0,
  maxLineBytes = Number.POSITIVE_INFINITY,
): Generator<TextLine> {
  const fd = openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(chunkSize)
  const lineLimit = Number.isFinite(maxLineBytes)
    ? Math.max(0, Math.floor(maxLineBytes))
    : Number.POSITIVE_INFINITY
  let decoder = new StringDecoder('utf8')
  let lineParts: string[] = []
  let lineByteLength = 0
  let truncated = false
  let lineIndex = 0
  let position = Math.max(0, Math.floor(startOffset))
  let nextByteOffset = position

  const appendSegment = (segment: Buffer): void => {
    if (!truncated) {
      const remaining = lineLimit - lineByteLength
      if (segment.length <= remaining) {
        lineParts.push(decoder.write(segment))
      } else {
        if (remaining > 0) lineParts.push(decoder.write(segment.subarray(0, remaining)))
        lineParts.push(decoder.end())
        truncated = true
      }
    }
    lineByteLength += segment.length
  }

  const resetLine = (): void => {
    decoder = new StringDecoder('utf8')
    lineParts = []
    lineByteLength = 0
    truncated = false
  }

  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position)
      if (bytesRead <= 0) break
      position += bytesRead

      let segmentStart = 0
      while (segmentStart < bytesRead) {
        const newline = buffer.indexOf(0x0a, segmentStart)
        if (newline < 0 || newline >= bytesRead) {
          appendSegment(buffer.subarray(segmentStart, bytesRead))
          break
        }

        appendSegment(buffer.subarray(segmentStart, newline))
        if (!truncated) lineParts.push(decoder.end())
        let line = lineParts.join('')
        if (!truncated && line.endsWith('\r')) line = line.substring(0, line.length - 1)
        const byteLength = lineByteLength + 1
        yield {
          line,
          lineIndex,
          byteOffset: nextByteOffset,
          byteLength,
          truncated,
        }
        nextByteOffset += byteLength
        lineIndex += 1
        resetLine()
        segmentStart = newline + 1
      }
    }

    if (lineByteLength > 0) {
      if (!truncated) lineParts.push(decoder.end())
      let line = lineParts.join('')
      if (!truncated && line.endsWith('\r')) line = line.substring(0, line.length - 1)
      yield {
        line,
        lineIndex,
        byteOffset: nextByteOffset,
        byteLength: lineByteLength,
        truncated,
      }
    }
  } finally {
    closeSync(fd)
  }
}

/** 读取文件指定偏移处的有限片段，用于校验恢复点。 */
export function readByteSnippet(file: string, offset: number, length = 512): string {
  if (!Number.isSafeInteger(offset) || offset < 0) return ''
  let fd: number | null = null
  try {
    fd = openSync(file, 'r')
    const buffer = Buffer.allocUnsafe(length)
    const bytesRead = readSync(fd, buffer, 0, length, offset)
    if (bytesRead <= 0) return ''
    return buffer.subarray(0, bytesRead).toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== null) closeSync(fd)
  }
}
