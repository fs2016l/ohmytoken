declare module 'gifenc/src/index.js' {
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: 'rgb565',
  ): Uint8Array
  export function GIFEncoder(options?: { auto?: boolean }): {
    reset(): void
    writeHeader(): void
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options: {
        first?: boolean
        palette?: number[][]
        delay?: number
        repeat?: number
        dispose?: number
      },
    ): void
    finish(): void
    bytesView(): Uint8Array<ArrayBuffer>
  }
}
