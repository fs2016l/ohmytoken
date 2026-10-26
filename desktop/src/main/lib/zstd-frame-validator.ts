/**
 * Node 的 zstd 解压可能把截断帧作为成功 EOF 返回，必须另外检查帧是否完整。
 * 这里只遍历帧/块边界，解压和校验和仍由原生 zstd 处理，最多缓存 4 字节。
 * 格式：https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md
 */
export class ZstdFrameValidator {
  private state: 'magic' | 'descriptor' | 'block' | 'skipSize' = 'magic'
  private readonly header = Buffer.allocUnsafe(4)
  private headerBytes = 0
  private needed = 4
  private skipBytes = 0
  private afterSkip: 'magic' | 'block' = 'magic'
  private checksum = false
  private frames = 0

  push(chunk: Buffer, emit: (segment: Buffer) => void): void {
    let position = 0
    let segmentStart = 0
    while (position < chunk.length) {
      if (this.skipBytes > 0) {
        const bytes = Math.min(this.skipBytes, chunk.length - position)
        this.skipBytes -= bytes
        position += bytes
        if (this.skipBytes === 0) {
          this.expect(this.afterSkip)
          if (this.state === 'magic') {
            emit(chunk.subarray(segmentStart, position))
            segmentStart = position
          }
        }
        continue
      }
      const bytes = Math.min(this.needed - this.headerBytes, chunk.length - position)
      chunk.copy(this.header, this.headerBytes, position, position + bytes)
      this.headerBytes += bytes
      position += bytes
      if (this.headerBytes !== this.needed) continue
      this.consumeHeader()
      if (this.state === 'magic' && this.headerBytes === 0 && this.skipBytes === 0) {
        emit(chunk.subarray(segmentStart, position))
        segmentStart = position
      }
    }
    if (segmentStart < chunk.length) emit(chunk.subarray(segmentStart))
  }

  finish(): void {
    if (this.frames === 0 || this.skipBytes > 0 || this.headerBytes > 0 || this.state !== 'magic') {
      throw new Error('zstd 数据帧不完整，已中止扫描')
    }
  }

  private expect(state: typeof this.state): void {
    this.state = state
    this.headerBytes = 0
    this.needed = state === 'descriptor' ? 1 : state === 'block' ? 3 : 4
  }

  private skip(bytes: number, next: 'magic' | 'block'): void {
    this.skipBytes = bytes
    this.afterSkip = next
    if (bytes === 0) this.expect(next)
  }

  private consumeHeader(): void {
    switch (this.state) {
      case 'magic': {
        const magic = this.header.readUInt32LE(0)
        if (magic === 0xfd2fb528) {
          this.frames++
          this.expect('descriptor')
        } else if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) {
          this.expect('skipSize')
        } else {
          throw new Error('zstd 数据帧标识无效')
        }
        break
      }
      case 'descriptor': {
        const descriptor = this.header[0]
        const singleSegment = Boolean(descriptor & 0x20)
        const sizeFlag = descriptor >> 6
        const contentSizeBytes = sizeFlag === 0 ? Number(singleSegment) : 2 ** sizeFlag
        const dictionaryBytes = [0, 1, 2, 4][descriptor & 3]
        this.checksum = Boolean(descriptor & 4)
        this.skip(Number(!singleSegment) + dictionaryBytes + contentSizeBytes, 'block')
        break
      }
      case 'block': {
        const block = this.header.readUIntLE(0, 3)
        const blockType = (block >> 1) & 3
        if (blockType === 3) throw new Error('zstd 数据块类型无效')
        const last = Boolean(block & 1)
        const payloadBytes = blockType === 1 ? 1 : block >> 3
        this.skip(payloadBytes + (last && this.checksum ? 4 : 0), last ? 'magic' : 'block')
        break
      }
      case 'skipSize':
        this.skip(this.header.readUInt32LE(0), 'magic')
        break
    }
  }
}
