import webpDecoder from "@jsquash/webp/codec/dec/webp_dec.js"
import webpWasm from "@jsquash/webp/codec/dec/webp_dec.wasm"
import jpegDecoder from "@jsquash/jpeg/codec/dec/mozjpeg_dec.js"
import jpegDecoderWasm from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm"
import jpegEncoder from "@jsquash/jpeg/codec/enc/mozjpeg_enc.js"
import jpegEncoderWasm from "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"
import { initEmscriptenModule } from "@jsquash/webp/utils.js"
import { defaultOptions } from "@jsquash/jpeg/meta.js"
import { jpegDimensions, MAX_PHOTO_PIXELS, MAX_PHOTO_SIDE } from "./jpeg"

export const PHOTO_WIDTHS = [640, 960] as const
export const variantKey = (key: string, width: number) => `${key}~w${width}.jpg`
// Codec initialization only, never a request's bytes, pixels, credentials or response in module scope.
let webp: ReturnType<typeof initEmscriptenModule<Awaited<ReturnType<typeof webpDecoder>>>> | undefined
let jpeg: ReturnType<typeof initEmscriptenModule<Awaited<ReturnType<typeof jpegDecoder>>>> | undefined
let encoder: ReturnType<typeof initEmscriptenModule<Awaited<ReturnType<typeof jpegEncoder>>>> | undefined

/** Inspect the WebP header before decoding to bound allocation (VP8/VP8L/VP8X). */
export function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const ascii = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n))
  if (bytes.length < 30 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP") return null
  const u24 = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)
  const u32 = (at: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true)
  const valid = (width: number, height: number) =>
    width > 0 && height > 0 && width <= MAX_PHOTO_SIDE && height <= MAX_PHOTO_SIDE && width * height <= MAX_PHOTO_PIXELS
  if (u32(4) + 8 !== bytes.length) return null
  let canvas: { width: number; height: number } | null = null
  let image: { width: number; height: number } | null = null
  for (let at = 12; at < bytes.length;) {
    if (at + 8 > bytes.length) return null
    const type = ascii(at, 4),
      length = u32(at + 4),
      start = at + 8
    if (start + length + (length & 1) > bytes.length) return null
    if (type === "ANIM" || type === "ANMF") return null
    if (type === "VP8X") {
      if (canvas || at !== 12 || length !== 10 || bytes[start] & 2) return null
      canvas = { width: 1 + u24(start + 4), height: 1 + u24(start + 7) }
      if (!valid(canvas.width, canvas.height)) return null
    } else if (type === "VP8L" || type === "VP8 ") {
      if (image) return null
      if (type === "VP8L" && length >= 5 && bytes[start] === 0x2f)
        image = {
          width: 1 + (bytes[start + 1] | ((bytes[start + 2] & 0x3f) << 8)),
          height: 1 + ((bytes[start + 2] >> 6) | (bytes[start + 3] << 2) | ((bytes[start + 4] & 0x0f) << 10)),
        }
      else if (type === "VP8 " && length >= 10 && bytes[start + 3] === 0x9d && bytes[start + 4] === 1 && bytes[start + 5] === 0x2a)
        image = {
          width: (bytes[start + 6] | (bytes[start + 7] << 8)) & 0x3fff,
          height: (bytes[start + 8] | (bytes[start + 9] << 8)) & 0x3fff,
        }
      else return null
      // A forged small VP8X canvas cannot hide a large embedded bitstream before the decoder allocates it.
      if (!valid(image.width, image.height) || (canvas && (canvas.width !== image.width || canvas.height !== image.height))) return null
    }
    at = start + length + (length & 1)
  }
  return image
}

/** A bounded bilinear resize preserves the full composition, unlike a cropped list thumbnail. */
export function resizePixels(
  image: { data: Uint8ClampedArray; width: number; height: number },
  maxWidth: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const width = Math.min(maxWidth, image.width)
  const height = Math.max(1, Math.round((image.height * width) / image.width))
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, Math.min(image.width - 1, ((x + 0.5) * image.width) / width - 0.5))
      const fy = Math.max(0, Math.min(image.height - 1, ((y + 0.5) * image.height) / height - 0.5))
      const sx = Math.floor(fx),
        sy = Math.floor(fy)
      const tx = fx - sx,
        ty = fy - sy
      const points = [
        [sx, sy, (1 - tx) * (1 - ty)],
        [Math.min(sx + 1, image.width - 1), sy, tx * (1 - ty)],
        [sx, Math.min(sy + 1, image.height - 1), (1 - tx) * ty],
        [Math.min(sx + 1, image.width - 1), Math.min(sy + 1, image.height - 1), tx * ty],
      ]
      const target = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        let sum = 0
        for (const [px, py, weight] of points) {
          const source = (py * image.width + px) * 4
          sum += (weight * (image.data[source + c] * image.data[source + 3] + 255 * (255 - image.data[source + 3]))) / 255
        }
        data[target + c] = Math.round(sum)
      }
      data[target + 3] = 255
    }
  return { data, width, height }
}

export async function mediumJpeg(bytes: Uint8Array, type: string, width: number): Promise<Uint8Array | null> {
  if (!(PHOTO_WIDTHS as readonly number[]).includes(width) || bytes.byteLength > 4 * 1024 * 1024) return null
  const bounds = type === "image/webp" ? webpDimensions(bytes) : jpegDimensions(bytes)
  if (!bounds) return null
  try {
    const image =
      type === "image/webp"
        ? (await (webp ??= initEmscriptenModule(webpDecoder, webpWasm))).decode(bytes)
        : (await (jpeg ??= initEmscriptenModule(jpegDecoder, jpegDecoderWasm))).decode(bytes, false)
    if (!image || image.width !== bounds.width || image.height !== bounds.height) return null
    const resized = resizePixels(image, width)
    const codec = await (encoder ??= initEmscriptenModule(jpegEncoder, jpegEncoderWasm))
    const result = codec.encode(resized.data, resized.width, resized.height, { ...defaultOptions, quality: 78, progressive: true })
    return result ? new Uint8Array(result) : null
  } catch {
    return null
  }
}

// A best-effort per-isolate memory guard, not a publication lock or global quota. Busy readers receive the original.
let rendering = false
export async function createMedium(
  media: R2Bucket,
  key: string,
  width: number,
  stillLive: () => Promise<boolean>,
): Promise<R2ObjectBody | null> {
  if (rendering) return null
  rendering = true
  const target = variantKey(key, width)
  try {
    const object = await media.get(key)
    if (!object || object.size > 4 * 1024 * 1024) return null
    const type = object.httpMetadata?.contentType ?? "image/jpeg"
    const result = await mediumJpeg(new Uint8Array(await object.arrayBuffer()), type, width)
    if (!result || !(await stillLive())) return null
    await media.put(target, result, { httpMetadata: { contentType: "image/jpeg" } })
    if (!(await stillLive())) {
      await media.delete(target)
      return null
    }
    return media.get(target)
  } finally {
    rendering = false
  }
}
