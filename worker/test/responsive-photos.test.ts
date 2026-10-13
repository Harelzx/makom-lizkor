import { env } from "cloudflare:workers"
import { expect, it } from "vitest"
import { mediumJpeg, webpDimensions, variantKey } from "../lib/photo-variants"
import { jpegDimensions, stripJpeg } from "../lib/jpeg"
import { TINY_WEBP, seedCurated } from "./curated-helpers"
import { call } from "./app"
import { feed, send, jpeg, seg, upload, queued, decide } from "./submission-helpers"
import { GREEN_JPEG } from "./photo-fixtures"

it("compiles the actual Worker codecs, creates JPEG sizes without upscaling and rejects pixel bombs before decode", async () => {
  expect(webpDimensions(TINY_WEBP)).toEqual({ width: 16, height: 16 })
  for (const [source, type] of [
    [TINY_WEBP, "image/webp"],
    [GREEN_JPEG, "image/jpeg"],
  ] as const) {
    const bytes = await mediumJpeg(source, type, 640)
    expect(bytes).not.toBeNull()
    expect(jpegDimensions(bytes!)).toEqual({ width: 16, height: 16 })
    expect(stripJpeg(bytes!)).not.toBeNull()
  }
  const bomb = jpeg()
  bomb[7] = 0x7f
  bomb[8] = 0xff
  expect(jpegDimensions(bomb)).toBeNull()
  expect(await mediumJpeg(bomb, "image/jpeg", 640)).toBeNull()
  expect(await mediumJpeg(TINY_WEBP, "image/webp", 12345)).toBeNull()
})

it("rejects a second or unsupported JPEG frame header instead of trusting a benign first size", () => {
  const first = seg(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0])
  const bomb = seg(0xc0, [8, 0x7f, 0xff, 0x7f, 0xff, 1, 1, 0x11, 0])
  const tail = [...seg(0xda, [1, 1, 0, 0, 63, 0]), 0x55, 0xff, 0xd9]
  for (const frame of [bomb, seg(0xc1, [8, 0, 16, 0, 16, 1, 1, 0x11, 0])])
    expect(jpegDimensions(new Uint8Array([0xff, 0xd8, ...first, ...frame, ...tail]))).toBeNull()
  expect(jpegDimensions(new Uint8Array([0xff, 0xd8, ...first]))).toBeNull()
})

it("checks the embedded WebP bitstream as well as its canvas before decoding", () => {
  const bytes = new Uint8Array(TINY_WEBP.length + 18)
  bytes.set(TINY_WEBP.subarray(0, 12))
  bytes.set(new TextEncoder().encode("VP8X"), 12)
  bytes[16] = 10
  bytes[24] = bytes[27] = 15
  bytes.set(TINY_WEBP.subarray(12), 30)
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true)
  expect(webpDimensions(bytes)).toEqual({ width: 16, height: 16 })
  // Valid-sized outer canvas, contradictory or enormous inner lossless dimensions.
  bytes[39] = 127
  expect(webpDimensions(bytes)).toBeNull()
  bytes[39] = 15
  bytes[20] = 2
  expect(webpDimensions(bytes)).toBeNull()
  const truncated = TINY_WEBP.slice(0, -1)
  expect(webpDimensions(truncated)).toBeNull()
})

it("serves medium images only through the current original's publication gate and withdrawal erases their files", async () => {
  const { id, trackingToken } = await send("דמו תמונה בגודל בינוני")
  expect((await upload(id, trackingToken, GREEN_JPEG)).status).toBe(200)
  await decide(id, await queued(id), "approve")
  const place = (await feed()).find((p) => p.id === id)!
  const url = (place.photo as { url: string }).url
  const key = url.replace(/^\/media\//, "")
  const medium = await call(`http://local${url}?w=640`)
  expect(medium.status).toBe(200)
  expect(medium.headers.get("Content-Type")).toBe("image/jpeg")
  expect(medium.headers.get("Cache-Control")).toBe("public, max-age=60")
  expect(await env.MEDIA.head(variantKey(key, 640))).not.toBeNull()
  expect((await call(`http://local/media/${variantKey(key, 640)}`)).status).toBe(404)
  await call(`http://local/api/v1/submissions/${id}/withdraw`, { method: "POST", headers: { Authorization: `Bearer ${trackingToken}` } })
  expect((await call(`http://local${url}?w=640`)).status).toBe(404)
  expect(await env.MEDIA.head(variantKey(key, 640))).toBeNull()
})

it("creates variants for curated WebP too, without changing source keys/credits or permitting arbitrary widths", async () => {
  await seedCurated(["nova-memorial-reim"])
  const place = (await feed()).find((p) => p.id === "nova-memorial-reim")!
  const photo = (place.curated as { photos: { url: string; author: string }[] }).photos[0]
  const r = await call(`http://local${photo.url}?w=960`)
  expect(r.status).toBe(200)
  expect(r.headers.get("Content-Type")).toBe("image/jpeg")
  expect(jpegDimensions(new Uint8Array(await r.arrayBuffer()))).toEqual({ width: 16, height: 16 })
  expect((await call(`http://local${photo.url}?w=50000`)).status).toBe(400)
  expect((await feed()).find((p) => p.id === place.id)).toEqual(place)
})
