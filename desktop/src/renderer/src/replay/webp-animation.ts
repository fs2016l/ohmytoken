// WebP RIFF container only. Frame compression is provided by Chromium's Canvas encoder.
// https://developers.google.com/speed/webp/docs/riff_container
const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(offset, offset + length))
function uint24(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value
  bytes[at + 1] = value >>> 8
  bytes[at + 2] = value >>> 16
}
function chunk(name: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(8 + payload.length + (payload.length & 1))
  bytes.set(new TextEncoder().encode(name))
  new DataView(bytes.buffer).setUint32(4, payload.length, true)
  bytes.set(payload, 8)
  return bytes
}
export function webpAnimationHeader(
  width: number,
  height: number,
  loop: boolean,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44)
  bytes.set(new TextEncoder().encode('RIFF'))
  bytes.set(new TextEncoder().encode('WEBP'), 8)
  const extended = new Uint8Array(10)
  extended[0] = 2 // Animation; full opaque frames.
  uint24(extended, 4, width - 1)
  uint24(extended, 7, height - 1)
  bytes.set(chunk('VP8X', extended), 12)
  const animation = new Uint8Array(6)
  animation[3] = 255
  new DataView(animation.buffer).setUint16(4, loop ? 0 : 1, true)
  bytes.set(chunk('ANIM', animation), 30)
  return bytes
}
export function webpAnimationFrame(
  image: Uint8Array,
  width: number,
  height: number,
  duration: number,
): Uint8Array<ArrayBuffer> {
  if (ascii(image, 0, 4) !== 'RIFF' || ascii(image, 8, 4) !== 'WEBP') throw new Error('unsupported')
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength)
  if (view.getUint32(4, true) + 8 !== image.length) throw new Error('invalid-webp')
  const chunks: Uint8Array[] = []
  let hasImage = false,
    length = 16
  for (let at = 12; at + 8 <= image.length;) {
    const name = ascii(image, at, 4),
      size = view.getUint32(at + 4, true)
    const end = at + 8 + size + (size & 1)
    if (end > image.length) throw new Error('invalid-webp')
    if (name === 'VP8 ' || name === 'VP8L') hasImage = true
    if (name === 'ALPH') throw new Error('unexpected-alpha')
    if (name === 'VP8 ' || name === 'VP8L') {
      chunks.push(image.subarray(at, end))
      length += end - at
    }
    at = end
  }
  if (!hasImage) throw new Error('invalid-webp')
  const payload = new Uint8Array(length)
  uint24(payload, 6, width - 1)
  uint24(payload, 9, height - 1)
  uint24(payload, 12, duration)
  payload[15] = 2 // Replace the entire previous frame; no alpha blending.
  let at = 16
  for (const bytes of chunks) {
    payload.set(bytes, at)
    at += bytes.length
  }
  return chunk('ANMF', payload)
}
