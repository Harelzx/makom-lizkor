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

/** A frame header (SOF0–SOF15), not DHT (C4), JPG (C8) or DAC (CC), which share the range. */
const isFrame = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc
const isJfif = (bytes: Uint8Array, i: number) =>
  bytes[i + 4] === 0x4a && bytes[i + 5] === 0x46 && bytes[i + 6] === 0x49 && bytes[i + 7] === 0x46 && bytes[i + 8] === 0

/**
 * Walks every segment to the end marker, the scans' coded data included, so metadata a progressive photo carries
 * between its scans goes too, and nothing after the end marker is kept. APP0 stays only as a plain JFIF header (a JFXX
 * thumbnail is another picture). A second frame header, or a photo that never ends, is refused.
 */
export function stripJpeg(bytes: Uint8Array): Uint8Array | null {
  if (!jpegDimensions(bytes)) return null
  const kept: Uint8Array[] = [bytes.subarray(0, 2)]
  let i = 2
  let scanned = false
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) return null
    const marker = bytes[i + 1]
    // Fill bytes before a marker.
    if (marker === 0xff) {
      i++
      continue
    }
    if (marker === 0xd9) {
      if (!scanned) return null
      kept.push(bytes.subarray(i, i + 2))
      const out = new Uint8Array(kept.reduce((n, k) => n + k.length, 0))
      let at = 0
      for (const k of kept) {
        out.set(k, at)
        at += k.length
      }
      return out
    }
    if (i + 4 > bytes.length) return null
    const length = (bytes[i + 2] << 8) | bytes[i + 3]
    if (length < 2 || i + 2 + length > bytes.length) return null
    if (scanned && isFrame(marker)) return null
    const metadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe || (marker === 0xe0 && !isJfif(bytes, i))
    if (!metadata) kept.push(bytes.subarray(i, i + 2 + length))
    i += 2 + length
    if (marker === 0xda) {
      // The scan's coded data: up to the next marker, past stuffed bytes (FF 00) and restart markers (FF D0–D7).
      scanned = true
      const from = i
      while (i + 1 < bytes.length && !(bytes[i] === 0xff && bytes[i + 1] !== 0 && (bytes[i + 1] < 0xd0 || bytes[i + 1] > 0xd7))) i++
      if (i + 1 >= bytes.length) return null
      kept.push(bytes.subarray(from, i))
    }
  }
  return null
}
