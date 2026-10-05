/**
 * The same JPEG without what a camera or an editor writes beside the picture: EXIF (with GPS), XMP, ICC and the other
 * APPn segments, and comments. Null when the bytes aren't a JPEG we can walk. The browser already re-encodes photos,
 * which drops all of this; the server doesn't rely on that.
 */
export function stripJpeg(bytes: Uint8Array): Uint8Array | null {
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
      return Uint8Array.from([...out, ...rest])
    }
    // APP0 (JFIF) stays; APP1–APP15 and comments go.
    const metadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe
    if (!metadata) for (let k = 0; k < 2 + length; k++) out.push(bytes[i + k])
    i += 2 + length
  }
  return null
}
