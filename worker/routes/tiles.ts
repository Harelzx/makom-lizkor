import { Hono } from "hono"
import { Compression, EtagMismatch, PMTiles, SharedPromiseCache, TileType, type DecompressFunc, type Source } from "pmtiles"
import { BASEMAP_ARCHIVE, basemapKey } from "@/shared/tiles"
import { problem } from "../lib/http"

/**
 * The basemap, a tile at a time, out of one PMTiles archive in R2 (src/shared/tiles.ts). The map's style asks here
 * instead of an outside tile server, so the map stays up whoever else goes down, and the policy needs no other host.
 */
export const tiles = new Hono<{ Bindings: Env }>()

/** Reads byte ranges of an archive in the bucket. An archive replaced under the same key is an etag mismatch. */
class R2Source implements Source {
  constructor(
    private bucket: R2Bucket,
    private key: string,
  ) {}
  getKey() {
    return this.key
  }
  async getBytes(offset: number, length: number, _signal?: AbortSignal, etag?: string) {
    const object = await this.bucket.get(this.key, { range: { offset, length }, onlyIf: etag ? { etagMatches: etag } : undefined })
    if (!object) throw new MissingArchive()
    if (!("body" in object)) throw new EtagMismatch()
    return { data: await object.arrayBuffer(), etag: object.etag }
  }
}
class MissingArchive extends Error {}

/** Directories are read once per isolate and kept; a tile is one more ranged read. */
const gunzip: DecompressFunc = async (buf, compression) => {
  if (compression === Compression.None || compression === Compression.Unknown) return buf
  if (compression !== Compression.Gzip) throw new Error("unsupported compression")
  return new Response(new Response(buf).body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
}
const directories = new SharedPromiseCache(64, false, gunzip)
// A tile goes out as it is stored, gzipped, and the browser unpacks it: unpacking it here only to pack it again would
// spend the Worker's time on every tile.
const asStored: DecompressFunc = async (buf) => buf

const Z = /^(?:[0-9]|1[0-9]|2[0-6])$/
const N = /^(?:0|[1-9][0-9]{0,7})$/

tiles.get("/:archive/:z/:x/:file{[0-9]+\\.pbf}", async (c) => {
  const { archive, z, x, file } = c.req.param()
  // Only the archive this version names: an old address would otherwise keep reading an archive no one maintains.
  if (archive !== BASEMAP_ARCHIVE) return problem(c, 404, "not_found")
  const y = file.slice(0, -4)
  if (!Z.test(z) || !N.test(x) || !N.test(y)) return problem(c, 400, "invalid_input")
  const [zn, xn, yn] = [Number(z), Number(x), Number(y)]
  if (xn >= 2 ** zn || yn >= 2 ** zn) return problem(c, 400, "invalid_input")
  const archiveFile = new PMTiles(new R2Source(c.env.TILES, basemapKey(archive)), directories, asStored)
  let header, tile
  try {
    header = await archiveFile.getHeader()
    tile = await archiveFile.getZxy(zn, xn, yn)
  } catch (err) {
    if (!(err instanceof MissingArchive)) throw err
    // The dev server's bucket starts empty, and the archive is far too big for git: there, the public site's own tiles
    // are relayed, so development and the browser tests draw the real map. Never anywhere else.
    if (c.env.ENVIRONMENT === "development" && c.env.TILES_UPSTREAM) return relay(c.env.TILES_UPSTREAM, c.req.path)
    // Not uploaded yet (a new deployment before its tiles): no map rather than a broken page.
    return problem(c, 404, "not_found")
  }
  if (header.tileType !== TileType.Mvt) throw new Error("the basemap archive is not vector tiles")
  // Immutable: the archive's name is in the address, and a new extract gets a new name.
  const cache = { "Cache-Control": "public, max-age=31536000, immutable" }
  // Nothing at this tile (open sea, or past the archive's zoom): an empty tile, which the map draws as nothing.
  if (!tile) return new Response(null, { status: 204, headers: cache })
  const headers = new Headers({ ...cache, "Content-Type": "application/vnd.mapbox-vector-tile" })
  if (header.tileCompression !== Compression.Gzip && header.tileCompression !== Compression.None)
    throw new Error("unsupported tile compression")
  // Vite's dev server passes the gzipped body on unzipped but keeps its zipped length, cutting every tile short; there
  // the tile is unzipped here instead. Deployed, workerd sends it as stored.
  if (c.env.ENVIRONMENT === "development") return new Response(await gunzip(tile.data, header.tileCompression), { status: 200, headers })
  if (header.tileCompression === Compression.Gzip) headers.set("Content-Encoding", "gzip")
  // The body is already gzipped: "manual" sends it as it is, instead of compressing it a second time.
  return new Response(tile.data, { status: 200, headers, encodeBody: "manual" })
})

async function relay(upstream: string, path: string) {
  // Offline, the dev server's map simply has no basemap.
  const res = await fetch(new URL(path, upstream)).catch(() => null)
  if (!res) return new Response(null, { status: 404 })
  // A site deployed before its tiles answers this address with its own page: that is no tile, and MapLibre would choke on
  // every one.
  if (res.status === 200 && !res.headers.get("Content-Type")?.startsWith("application/vnd.mapbox-vector-tile")) {
    await res.body?.cancel()
    return new Response(null, { status: 404 })
  }
  const headers = new Headers()
  for (const name of ["Content-Type", "Cache-Control"]) {
    const value = res.headers.get(name)
    if (value) headers.set(name, value)
  }
  return new Response(res.status === 200 ? res.body : null, {
    status: res.status === 200 || res.status === 204 ? res.status : 404,
    headers,
  })
}
