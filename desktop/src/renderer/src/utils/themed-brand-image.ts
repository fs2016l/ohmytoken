import { shallowRef, type ShallowRef } from 'vue'
import { isTintableBrandImage } from './brand-image-pixels'

interface BrandImage {
  canvas: ShallowRef<HTMLCanvasElement | null | undefined>
  variants: Map<string, string>
}

const MAX_IMAGES = 128
const MAX_VARIANTS = 8
const MAX_SIDE = 256
const images = new Map<string, BrandImage>()

async function readImage(url: string, entry: BrandImage): Promise<void> {
  try {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.src = url
    await image.decode()
    const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Canvas is unavailable')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    entry.canvas.value = isTintableBrandImage(
      context.getImageData(0, 0, canvas.width, canvas.height).data,
    )
      ? canvas
      : null
  } catch {
    // Unsupported images retain their original rendering; never guess a brand's colors.
    entry.canvas.value = null
  }
}

/** One themed URL serves DOM images, chart legends, tooltips and canvas charts alike. */
export function themedBrandImageUrl(url: string, foreground: string): string | undefined {
  // Animated GIF artwork must not be flattened to its first frame.
  if (/\.gif(?:$|[?#])|^data:image\/gif[;,]/i.test(url)) return url
  let entry = images.get(url)
  if (!entry) {
    entry = { canvas: shallowRef(undefined), variants: new Map() }
    images.set(url, entry)
    if (images.size > MAX_IMAGES) images.delete(images.keys().next().value!)
    void readImage(url, entry)
  } else {
    images.delete(url)
    images.set(url, entry)
  }
  const source = entry.canvas.value
  // Avoid briefly painting a black logo on a dark surface while the cached image decodes.
  if (source === undefined) return undefined
  if (source === null) return url
  const existing = entry.variants.get(foreground)
  if (existing) return existing
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const context = canvas.getContext('2d')
  if (!context) return url
  context.drawImage(source, 0, 0)
  context.globalCompositeOperation = 'source-in'
  context.fillStyle = foreground
  context.fillRect(0, 0, canvas.width, canvas.height)
  const result = canvas.toDataURL('image/png')
  entry.variants.set(foreground, result)
  if (entry.variants.size > MAX_VARIANTS) entry.variants.delete(entry.variants.keys().next().value!)
  return result
}
