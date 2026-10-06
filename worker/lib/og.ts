import { initWasm, Resvg } from "@resvg/resvg-wasm"
import wasm from "@resvg/resvg-wasm/index_bg.wasm"
import { isCurated, type PublicPlace } from "@/shared/contract"
import { CURATED_ID } from "@/shared/curated"
import { publicPlace } from "../db/places"
import { OG_FONTS } from "./og-font"
import { log } from "./log"

/**
 * A contribution's own share image (L4; adviser 20261006T150641Z-d7b8b866). Its address carries the hash of everything
 * the image shows, taken from the place's public projection as the feed serves it (every active hide applied): so the
 * gate can tell at any moment whether an image is the current one, and a hide, a correction or a withdrawal retires
 * every older address at once, whether or not a render ever ran. Rendering is lazy, on the first request for the
 * current hash, and never stands between a removal and its effect.
 */

/** Bump with any change to the layout, the font or the rendering, so every image is drawn again. */
// 2: a projected photo that can't be read is a failed render, never an image drawn without it (adviser a47, L4-R1).
export const OG_TEMPLATE_VERSION = 2
const W = 1200
const H = 630

/** What the image shows, and nothing else: the hash is taken over exactly this. */
export type OgProjection = { v: number; kind: string; name_he: string; place_he: string; photo: string | null }

/**
 * The photo is named by its key: a key is written once (its name carries the upload's ULID) and never rewritten with
 * other bytes, so the key stands for its content.
 */
function project(place: PublicPlace): OgProjection {
  return {
    v: OG_TEMPLATE_VERSION,
    kind: place.kind,
    name_he: place.name_he,
    place_he: place.place_he,
    // A curated place shows its first photo, a contribution its one photo; a hidden photo isn't in the projection.
    photo: (isCurated(place) ? place.curated.photos[0]?.url : place.photo?.url)?.replace(/^\/media\//, "") ?? null,
  }
}

async function hashOf(p: OgProjection) {
  // Keys in a fixed order: the same state always hashes the same.
  const canonical = JSON.stringify([p.v, p.kind, p.name_he, p.place_he, p.photo])
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("")
}

/** The current image of a published contribution, or null when it has none to show (not published, hidden). */
export async function ogState(db: D1Database, id: string): Promise<{ projection: OgProjection; hash: string } | null> {
  const found = await publicPlace(db, id)
  if (found.kind !== "published") return null
  const projection = project(found.place)
  return { projection, hash: await hashOf(projection) }
}

/** Base64 in slices: a spread of a photo's megabytes into one call would overflow the stack. */
function base64(bytes: Uint8Array) {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")

/** Words into at most `lines` lines of about `width` characters, the last cut with an ellipsis if it overflows. */
function wrap(text: string, width: number, lines: number) {
  const out: string[] = []
  let line = ""
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = word
    else if (Array.from(`${line} ${word}`).length <= width) line = `${line} ${word}`
    else {
      out.push(line)
      line = word
    }
  }
  if (line) out.push(line)
  if (out.length <= lines)
    return out.map((l) =>
      Array.from(l).length > width
        ? `${Array.from(l)
            .slice(0, width - 1)
            .join("")}…`
        : l,
    )
  const kept = out.slice(0, lines)
  kept[lines - 1] = `${Array.from(kept[lines - 1])
    .slice(0, width - 1)
    .join("")}…`
  return kept
}

let ready: Promise<void> | undefined
let fonts: Uint8Array[] | undefined

/**
 * The SVG, drawn by our code only: visitor text escaped, the photo inlined from its bytes, nothing fetched. Lines end
 * at the right margin (resvg anchors as if left to right, so the anchor is "end"); `direction` orders mixed text.
 */
export function ogSvg(p: OgProjection, photo: Uint8Array | null) {
  const textRight = W - 80
  const textWidth = photo ? 620 : 1040
  const nameLines = wrap(p.name_he, Math.floor(textWidth / 34), 2)
  const placeLines = p.place_he ? wrap(p.place_he, Math.floor(textWidth / 20), 1) : []
  const photoPart = photo
    ? `<defs><clipPath id="c"><rect x="0" y="0" width="440" height="${H}"/></clipPath></defs>
       <image x="0" y="0" width="440" height="${H}" preserveAspectRatio="xMidYMid slice" clip-path="url(#c)"
         href="data:image/jpeg;base64,${base64(photo)}"/>`
    : ""
  const name = nameLines
    .map((l, i) => `<text x="${textRight}" y="${250 + i * 82}" font-size="68" font-weight="700" fill="#f4efe8">${esc(l)}</text>`)
    .join("")
  const place = placeLines
    .map(
      (l) =>
        `<text x="${textRight}" y="${250 + nameLines.length * 82 + 20}" font-size="38" font-weight="500" fill="#c9bfb3">${esc(l)}</text>`,
    )
    .join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#16131c"/>${photoPart}
    <g font-family="Heebo" direction="rtl" text-anchor="end">${name}${place}
      <text x="${textRight}" y="${H - 70}" font-size="34" font-weight="700" fill="#e05a4f">מקום לזכור</text>
    </g></svg>`
}

/** The PNG for a projection, with the photo's approved bytes when it shows one. */
export async function renderOg(p: OgProjection, photo: Uint8Array | null): Promise<Uint8Array> {
  // Once per isolate; a module loaded again in the same isolate (a reload in development) finds it already done.
  ready ??= initWasm(wasm).catch((err: Error) => {
    if (!/already initialized/i.test(err.message)) throw err
  })
  await ready
  fonts ??= OG_FONTS.map((b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0)))
  const resvg = new Resvg(ogSvg(p, photo), { font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: "Heebo" } })
  const image = resvg.render()
  try {
    return image.asPng()
  } finally {
    image.free()
    resvg.free()
  }
}

const NOT_FOUND = () =>
  new Response(JSON.stringify({ status: 404, code: "not_found" }), {
    status: 404,
    headers: { "Content-Type": "application/problem+json", "Cache-Control": "no-store" },
  })

/**
 * /media/og/<id>/<hash>.png. Served only while the hash is the place's current one: checked before anything is read or
 * drawn (a malformed or stale address never renders), and again just before the bytes go out, after the photo was
 * read, the image drawn and stored, so a hide or withdrawal that lands meanwhile wins, and a file this request wrote
 * for a state that is no longer current is deleted. Two requests at once draw the same bytes under the same name.
 * A failed render, or a photo the projection names that can't be read now, sends the general image, uncached, and
 * stores nothing: the next request tries again.
 */
export async function ogResponse(
  env: { db: D1Database; media: R2Bucket },
  id: string,
  hash: string,
  render: (p: OgProjection, photo: Uint8Array | null) => Promise<Uint8Array> = renderOg,
): Promise<Response> {
  if (!(/^p_[0-9A-Z]{26}$/.test(id) || CURATED_ID.test(id)) || !/^[0-9a-f]{64}$/.test(hash)) return NOT_FOUND()
  const state = await ogState(env.db, id)
  if (!state || state.hash !== hash) return NOT_FOUND()
  const key = `og/${id}/${hash}.png`
  let bytes: Uint8Array
  let wrote = false
  const stored = await env.media.get(key)
  if (stored) bytes = new Uint8Array(await stored.arrayBuffer())
  else {
    try {
      const photo = state.projection.photo ? await env.media.get(state.projection.photo) : null
      // The hash names the photo: drawn without it, the image would be stored and served as if it had it, for good.
      if (state.projection.photo && !photo) throw new Error("photo_unavailable")
      bytes = await render(state.projection, photo ? new Uint8Array(await photo.arrayBuffer()) : null)
    } catch (err) {
      log("error", "og_render_failed", { error: (err as Error).name })
      return new Response(null, {
        status: 302,
        headers: { Location: "/og.png", "Cache-Control": "no-store", "Cloudflare-CDN-Cache-Control": "no-store" },
      })
    }
    await env.media.put(key, bytes, { httpMetadata: { contentType: "image/png" } })
    wrote = true
  }
  const now = await ogState(env.db, id)
  if (!now || now.hash !== hash) {
    if (wrote) await env.media.delete(key).catch(() => undefined)
    return NOT_FOUND()
  }
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      // As the photo (spec 5): a minute in the browser and at the edge, under the place's tag, so a takedown's purge
      // reaches it and the minute bounds it if the purge fails.
      "Cache-Control": "public, max-age=60",
      "Cloudflare-CDN-Cache-Control": "max-age=60",
      "Cache-Tag": `place:${id}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  })
}
