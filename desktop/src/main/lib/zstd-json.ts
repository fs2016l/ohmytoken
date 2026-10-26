import { zstdDecompressSync } from 'node:zlib'
import { TextDecoder } from 'node:util'
import { ZstdFrameValidator } from './zstd-frame-validator'

/** 完整性校验先于解码；逐帧处理，避免原生解码器忽略空帧之后的内容。 */
export function decompressZstd(bytes: Uint8Array, limit: number): Buffer {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid zstd output limit')
  const validator = new ZstdFrameValidator()
  const frames: Buffer[] = []
  validator.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), (frame) =>
    frames.push(frame),
  )
  validator.finish()
  const decoded: Buffer[] = []
  let size = 0
  for (const frame of frames) {
    // 可跳过帧没有输出；原生实现对这类帧的行为因运行时版本而异。
    const magic = frame.readUInt32LE(0)
    if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) continue
    const output = zstdDecompressSync(frame, { maxOutputLength: Math.max(1, limit - size) })
    size += output.length
    if (size > limit) throw new Error('zstd payload too large')
    decoded.push(output)
  }
  return Buffer.concat(decoded, size)
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
