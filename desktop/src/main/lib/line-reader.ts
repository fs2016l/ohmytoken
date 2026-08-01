import { closeSync, openSync, readSync } from 'fs'
import { StringDecoder } from 'string_decoder'

export interface TextLine {
  line: string
  /** 从 0 开始的绝对行号，保证增量/全量使用相同的 fallback API ID。 */
  lineIndex: number
}

/** 以固定块、低内存遍历 UTF-8 文本行。 */
export function* readUtf8Lines(file: string, chunkSize = 256 * 1024): Generator<TextLine> {
  const fd = openSync(file, 'r')
  const decoder = new StringDecoder('utf8')
  const buffer = Buffer.allocUnsafe(chunkSize)
  let pending = ''
  let lineIndex = 0
  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null)
      if (bytesRead <= 0) break
      pending += decoder.write(buffer.subarray(0, bytesRead))
      let newline = pending.indexOf('\n')
      while (newline >= 0) {
        let line = pending.substring(0, newline)
        if (line.endsWith('\r')) line = line.substring(0, line.length - 1)
        yield { line, lineIndex }
        lineIndex += 1
        pending = pending.substring(newline + 1)
        newline = pending.indexOf('\n')
      }
    }
    pending += decoder.end()
    if (pending.length > 0) {
      if (pending.endsWith('\r')) pending = pending.substring(0, pending.length - 1)
      yield { line: pending, lineIndex }
    }
  } finally {
    closeSync(fd)
  }
}
