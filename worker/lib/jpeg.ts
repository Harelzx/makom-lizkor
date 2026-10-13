/**
 * The same JPEG without what a camera or an editor writes beside the picture: EXIF (with GPS), XMP, ICC and the other
 * APPn segments, and comments. Null when the bytes aren't a JPEG we can walk. The browser already re-encodes photos,
 * which drops all of this; the server doesn't rely on that.
 */
export const MAX_PHOTO_PIXELS = 4_000_000
export const MAX_PHOTO_SIDE = 4096

/** Read dimensions before allocating decoded pixels. Only 8-bit baseline/progressive JPEG, never unbounded sizes. */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let i = 2
  let dimensions: { width: number; height: number } | null = null
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null
    const marker = bytes[i + 1]
    const length = (bytes[i + 2] << 8) | bytes[i + 3]
    if (length < 2 || i + 2 + length > bytes.length) return null
    if (marker === 0xc0 || marker === 0xc2) {
      if (dimensions || bytes[i + 4] !== 8 || ![1, 3].includes(bytes[i + 9]) || length !== 8 + 3 * bytes[i + 9]) return null
      const height = (bytes[i + 5] << 8) | bytes[i + 6]
      const width = (bytes[i + 7] << 8) | bytes[i + 8]
      dimensions =
        width > 0 && height > 0 && width <= MAX_PHOTO_SIDE && height <= MAX_PHOTO_SIDE && width * height <= MAX_PHOTO_PIXELS
          ? { width, height }
          : null
      if (!dimensions) return null
    } else if ([0xc1, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return null
    if (marker === 0xda) return dimensions
    i += 2 + length
  }
  return null
}

export function stripJpeg(bytes: Uint8Array): Uint8Array | null {
  if (!jpegDimensions(bytes)) return null
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const out: number[] = [0xff, 0xd8]
  let i = 2
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null
    const marker = bytes[i + 1]
    const length = (bytes[i + 2] << 8) | bytes[i + 3]
    if (length < 2 || i + 2 + length > bytes.length) return null
    // Start of scan: the picture itself follows, to the end. Everything before it was a header segment.
    if (marker === 0xda) {
      const rest = bytes.subarray(i)
      if (rest.length < 2 || rest[rest.length - 2] !== 0xff || rest[rest.length - 1] !== 0xd9) return null
      const result = new Uint8Array(out.length + rest.length)
      result.set(out)
      result.set(rest, out.length)
      return result
    }
    // APP0 (JFIF) stays; APP1–APP15 and comments go.
    const metadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe
    if (!metadata) for (let k = 0; k < 2 + length; k++) out.push(bytes[i + k])
    i += 2 + length
  }
  return null
}
