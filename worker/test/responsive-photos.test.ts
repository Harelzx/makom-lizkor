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

it("strips metadata between a progressive photo's scans and anything after its end, keeping every scan whole", () => {
  // A progressive JPEG has several scans; an editor (or someone crafting a file) can put EXIF, a comment or bytes after
  // the end marker between or after them. The browser's re-encode drops these, but an upload can come from elsewhere.
  const ascii = (t: string) => [...new TextEncoder().encode(t)]
  const sof = seg(0xc2, [8, 0, 16, 0, 16, 1, 1, 0x11, 0])
  const scan1 = [...seg(0xda, [1, 1, 0, 0, 0, 0]), 0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]
  const exif = seg(0xe1, [...ascii("Exif"), 0, 0, ...ascii("GPS 31.5 34.5")])
  const comment = seg(0xfe, ascii("secret comment"))
  const dht = seg(0xc4, [0x10, ...new Array(16).fill(0), 0])
  const scan2 = [...seg(0xda, [1, 1, 0, 1, 63, 0]), 0x78, 0xff, 0x00, 0x9a]
  const trailing = ascii("<script>alert(1)</script>")
  const app0 = seg(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])
  const input = new Uint8Array([0xff, 0xd8, ...app0, ...sof, ...scan1, ...exif, ...comment, ...dht, ...scan2, 0xff, 0xd9, ...trailing])
  const out = stripJpeg(input)!
  expect(out).not.toBeNull()
  expect([...out]).toEqual([0xff, 0xd8, ...app0, ...sof, ...scan1, ...dht, ...scan2, 0xff, 0xd9])
  const text = new TextDecoder("latin1").decode(out)
  for (const word of ["Exif", "GPS", "secret", "script"]) expect(text).not.toContain(word)

  // A JFXX thumbnail rides in APP0 too: only a plain JFIF header stays.
  const jfxx = seg(0xe0, [...ascii("JFXX"), 0, 0x10, ...new Array(20).fill(0x99)])
  const withThumb = new Uint8Array([0xff, 0xd8, ...jfxx, ...sof, ...scan2, 0xff, 0xd9])
  expect([...stripJpeg(withThumb)!]).toEqual([0xff, 0xd8, ...sof, ...scan2, 0xff, 0xd9])

  // A frame header after a scan, or a photo that never ends, is not one we walk.
  expect(
    stripJpeg(
      new Uint8Array([0xff, 0xd8, ...sof, ...scan1, ...seg(0xc0, [8, 0x7f, 0xff, 0x7f, 0xff, 1, 1, 0x11, 0]), ...scan2, 0xff, 0xd9]),
    ),
  ).toBeNull()
  expect(stripJpeg(new Uint8Array([0xff, 0xd8, ...sof, ...scan1]))).toBeNull()
})
