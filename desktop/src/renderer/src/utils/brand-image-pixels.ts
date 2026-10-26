/** Only neutral, single-ink marks with transparency can safely follow the UI foreground. */
export function isTintableBrandImage(pixels: Uint8ClampedArray): boolean {
  let visible = 0
  let transparent = 0
  let darkest = 255
  let lightest = 0
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3]
    if (alpha < 16) {
      transparent++
      continue
    }
    const red = pixels[index]
    const green = pixels[index + 1]
    const blue = pixels[index + 2]
    // Preserve brand colors, even when only a small part of the logo is colored.
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 12) return false
    if (alpha < 128) continue
    visible++
    const luminance = (red + green + blue) / 3
    darkest = Math.min(darkest, luminance)
    lightest = Math.max(lightest, luminance)
  }
  // A white-on-black badge or a shaded grayscale image must keep its internal contrast.
  return visible > 0 && transparent > pixels.length / 4 / 100 && lightest - darkest <= 32
}
