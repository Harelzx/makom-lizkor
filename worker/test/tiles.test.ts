import { env } from "cloudflare:workers"
import { beforeAll, describe, expect, it } from "vitest"
import { BASEMAP_ARCHIVE, basemapKey } from "@/shared/tiles"
import { call } from "./app"

const varint = (out: number[], n: number) => {
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80)
    n = Math.floor(n / 128)
  }
  out.push(n)
}

const gzip = async (bytes: Uint8Array) =>
  new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer())

/**
 * A PMTiles v3 archive of vector tiles, gzipped as Planetiler writes them, with tiles at the given ids (z0 is id 0, z1
 * ids 1 to 4). Padded past the 16 KiB the reader first asks for, like any real archive.
 */
async function archive(tiles: [id: number, data: Uint8Array][]) {
  const stored = await Promise.all(tiles.map(async ([id, data]) => [id, await gzip(data)] as const))
  const dir: number[] = []
  varint(dir, stored.length)
  let last = 0
  for (const [id] of stored) {
    varint(dir, id - last)
    last = id
  }
  for (let i = 0; i < stored.length; i++) varint(dir, 1)
  for (const [, data] of stored) varint(dir, data.length)
  let offset = 0
  for (const [, data] of stored) {
    varint(dir, offset + 1)
    offset += data.length
  }
  const metadata = new TextEncoder().encode("{}")
  const rootAt = 127,
    metaAt = rootAt + dir.length,
    dataAt = metaAt + metadata.length
  const size = Math.max(dataAt + offset, 20_000)
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode("PMTiles"), 0)
  bytes[7] = 3
  const fields = [rootAt, dir.length, metaAt, metadata.length, dataAt, 0, dataAt, offset, stored.length, stored.length, stored.length]
  fields.forEach((n, i) => view.setUint32(8 + 8 * i, n, true))
  bytes[96] = 1 // clustered
  bytes[97] = 1 // directories: none
  bytes[98] = 2 // tiles: gzip
  bytes[99] = 1 // MVT
  bytes[100] = 0
  bytes[101] = 14
  bytes.set(dir, rootAt)
  bytes.set(metadata, metaAt)
  let at = dataAt
  for (const [, data] of stored) {
    bytes.set(data, at)
    at += data.length
  }
  return bytes
}

const TILE = new TextEncoder().encode("a vector tile's bytes")
const url = (path: string) => `http://local/tiles/${BASEMAP_ARCHIVE}/${path}`

describe("the basemap's tiles", () => {
  beforeAll(async () => {
    await env.TILES.put(basemapKey(BASEMAP_ARCHIVE), await archive([[0, TILE]]))
  })

  it("serve a tile as it is stored, gzipped, cached for good", async () => {
    const res = await call(url("0/0/0.pbf"), {}, { ...env, ENVIRONMENT: "production" })
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/vnd.mapbox-vector-tile")
    expect(res.headers.get("Content-Encoding")).toBe("gzip")
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable")
    // The site's own headers on it too, like everything the Worker answers.
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'")
    const body = new Uint8Array(await res.arrayBuffer())
    const unpacked = new Uint8Array(
      await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer(),
    )
    expect(unpacked).toEqual(TILE)
  })

  it("unzip the tile on a dev server, whose proxy would cut a gzipped one short", async () => {
    const res = await call(url("0/0/0.pbf"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Encoding")).toBeNull()
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(TILE)
  })

  it("answer an empty tile where the archive has nothing, so the map draws nothing there", async () => {
    const res = await call(url("1/0/0.pbf"))
    expect(res.status).toBe(204)
    expect(await res.text()).toBe("")
    // Past the archive's zoom too.
    expect((await call(url("15/19500/13300.pbf"))).status).toBe(204)
  })

  it("refuse another archive's name and tiles that cannot exist", async () => {
    expect((await call("http://local/tiles/israel-openmaptiles-19700101/0/0/0.pbf")).status).toBe(404)
    expect((await call(url("1/2/0.pbf"))).status).toBe(400)
    expect((await call(url("27/0/0.pbf"))).status).toBe(400)
    expect((await call(url("01/0/0.pbf"))).status).toBe(400)
    expect((await call(url("0/0/0.png"))).status).toBe(404)
  })

  const empty = { get: async () => null } as unknown as R2Bucket

  it("answer not found, not an error, while the archive isn't uploaded", async () => {
    const res = await call(url("0/0/0.pbf"), {}, { ...env, ENVIRONMENT: "production", TILES: empty })
    expect(res.status).toBe(404)
  })

  it("relay the public site's tiles to a dev server whose bucket has none, and only there", async () => {
    const asked: string[] = []
    const real = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input))
      return new Response(TILE, { headers: { "Content-Type": "application/vnd.mapbox-vector-tile", "Set-Cookie": "x=1" } })
    }) as typeof fetch
    try {
      const res = await call(
        url("0/0/0.pbf"),
        {},
        { ...env, ENVIRONMENT: "development", TILES_UPSTREAM: "https://upstream.example", TILES: empty },
      )
      expect(res.status).toBe(200)
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(TILE)
      expect(res.headers.get("Set-Cookie")).toBeNull()
      expect(asked).toEqual([`https://upstream.example/tiles/${BASEMAP_ARCHIVE}/0/0/0.pbf`])
      // A site that doesn't serve tiles yet answers with its page, which is relayed as no tile at all.
      const page = new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } })
      globalThis.fetch = (async () => page) as typeof fetch
      const html = await call(
        url("0/0/0.pbf"),
        {},
        { ...env, ENVIRONMENT: "development", TILES_UPSTREAM: "https://upstream.example", TILES: empty },
      )
      expect(html.status).toBe(404)
      const staging = await call(
        url("0/0/0.pbf"),
        {},
        { ...env, ENVIRONMENT: "staging", TILES_UPSTREAM: "https://upstream.example", TILES: empty },
      )
      expect(staging.status).toBe(404)
      expect(asked).toHaveLength(1)
    } finally {
      globalThis.fetch = real
    }
  })
})
