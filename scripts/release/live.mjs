// What any release must leave true on the live site, checked anonymously right after the deploy. The only writes are
// two refused POSTs (a foreign-Origin anemone, a submission without Turnstile): nothing is counted or stored, no mail
// goes. Checks of one release's own change belong in the e2e suite, not here.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { gunzipSync } from "node:zlib"
import { OLD_ORIGIN, ORIGIN } from "./lib.mjs"

const PRIVATE = [
  "/admin/",
  "/api/admin/queue",
  "/api/admin/summary",
  "/api/admin/health",
  "/api/ops/summary",
  "/api/v1/health",
  "/__dev/login",
  "/preview-login",
  "/api/admin/commissioning/snapshot",
]
const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1"

/**
 * `repo`: the release worktree (its CSP, JPEG reader, contract and terrain files are the ones deployed); `pkg`: the
 * package directory; `tag`: the version tag production must answer with.
 */
export async function checkLive(repo, pkg, tag, sha) {
  const { CSP } = await import(resolve(repo, "worker/lib/security-headers.ts"))
  const { jpegDimensions } = await import(resolve(repo, "worker/lib/jpeg.ts"))
  const { CURRENT_SUBMISSION_NOTICE, SubmissionInput } = await import(resolve(repo, "src/shared/contract.ts"))
  const rows = []
  const get = async (path, options = {}) => {
    const started = Date.now()
    const r = await fetch(path.startsWith("http") ? path : ORIGIN + path, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      ...options,
    })
    rows.push({
      path,
      method: options.method || "GET",
      status: r.status,
      ms: Date.now() - started,
      version: r.headers.get("x-worker-version"),
    })
    return r
  }

  const version = await get("/api/v1/version")
  assert.equal(version.status, 200)
  assert.equal(version.headers.get("x-worker-version"), tag, "live version is not this release")
  assert(version.headers.get("cache-control").includes("no-store"))
  const { v } = await version.json()

  // The page as built: its policy, its caching, and no beacon injected by the edge (Safari included).
  const root = await get("/")
  assert.equal(root.status, 200, "homepage")
  assert.equal(root.headers.get("content-security-policy"), CSP)
  assert.equal(root.headers.get("content-security-policy-report-only"), null)
  assert.equal(root.headers.get("cache-control"), "no-cache, no-transform")
  const html = await root.text()
  const meta = (key) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1]
  assert.equal(meta("og:image"), `${ORIGIN}/og.png`, "home og:image")
  assert(html.includes(`<link rel="canonical" href="${ORIGIN}/"`), "home canonical")
  for (const path of ["/", "/place/nova-memorial-reim"]) {
    const r = await get(path, { headers: { "User-Agent": SAFARI, Accept: "text/html" } })
    assert(!(await r.text()).includes("cloudflareinsights"), `analytics beacon injected into ${path}`)
  }

  // The site's files and the moderators' page's files, from the package, are served whole and cached for good.
  const adminHtml = readFileSync(resolve(pkg, "client/admin/index.html"), "utf8")
  const assets = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g), ...adminHtml.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map(
        (m) => m[1],
      ),
    ),
  ]
  assert(assets.length > 2, "no assets found")
  for (const path of assets) {
    const r = await get(path)
    assert.equal(r.status, 200, path)
    assert.equal(r.headers.get("cache-control"), "public, max-age=31536000, immutable", path)
    if (path.endsWith(".css")) assert(!(await r.text()).includes("data:font"), `${path} inlines a font`)
    else await r.body?.cancel()
  }

  // The places, and a photo with its two served sizes.
  const feed = await get(`/api/v1/feed?v=${encodeURIComponent(v)}`)
  assert.equal(feed.status, 200)
  assert(feed.headers.get("cache-control").includes("no-store"))
  const places = (await feed.json()).places
  assert(places.length >= 90, `only ${places.length} places in the feed`)
  const place = places.find((p) => p.id === "nahal-oz-observers-memorial")
  assert(place?.curated.photos.length, "the sample place's photo")
  const photo = place.curated.photos[0].url
  assert.equal((await get(photo)).status, 200)
  for (const width of [640, 960]) {
    const r = await get(`${photo}?w=${width}`)
    assert.equal(r.status, 200)
    assert.equal(jpegDimensions(new Uint8Array(await r.arrayBuffer()))?.width, width)
  }

  // A place's share page names its own address once.
  const share = await get("/place/nova-memorial-reim")
  assert.equal(share.status, 200)
  const shareHtml = await share.text()
  assert.equal(shareHtml.match(/property="og:url"/g)?.length, 1, "one og:url on a place")
  assert.equal(shareHtml.match(/rel="canonical"/g)?.length, 1, "one canonical on a place")

  // The private paths stay behind Access, writes included.
  for (const path of PRIVATE) {
    const r = await get(path)
    assert([302, 303, 401, 403].includes(r.status), `private path open: ${path} ${r.status}`)
    await r.body?.cancel()
  }
  for (const path of ["/api/admin/places/p_00000000000000000000000000/erase", "/api/admin/reports/r_x/purge"]) {
    const r = await get(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    assert([302, 303, 401, 403].includes(r.status), `${path} open: ${r.status}`)
    await r.body?.cancel()
  }

  // Writes from outside are refused before they count: a proposal without Turnstile, an anemone from another site.
  const negative = SubmissionInput.parse({
    kind: "bench",
    name_he: "בדיקה שלילית בלבד",
    lat: 31.42,
    lng: 34.49,
    consent_version: CURRENT_SUBMISSION_NOTICE,
  })
  const denied = await get("/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `synthetic-negative-${sha.slice(0, 12)}` },
    body: JSON.stringify(negative),
  })
  assert.equal(denied.status, 403)
  assert.equal((await denied.json()).code, "turnstile_required")
  const foreign = await get("/api/v1/tributes", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://example.com", "Idempotency-Key": "0".repeat(32) },
    body: JSON.stringify({ placeId: "nahal-oz-observers-memorial", deviceId: "f".repeat(32) }),
  })
  assert.equal(foreign.status, 403, "foreign-Origin anemone")
  assert.equal((await foreign.json()).code, "cross_site")

  // The map's own tiles and terrain.
  const tile = await get("/assets/israel-openmaptiles-20261013.10.611.415.pbf", { headers: { "Accept-Encoding": "identity" } })
  assert.equal(tile.status, 200, "basemap tile")
  assert.equal(tile.headers.get("content-type"), "application/vnd.mapbox-vector-tile")
  let tileBytes = Buffer.from(await tile.arrayBuffer())
  if (tileBytes[0] === 0x1f && tileBytes[1] === 0x8b) tileBytes = gunzipSync(tileBytes)
  assert(tileBytes.length > 100, "basemap tile is empty")
  const terrainName = "terrain-1.8.153.105.png"
  const terrain = await get(`/assets/${terrainName}`)
  assert.equal(terrain.status, 200, "terrain tile")
  const hash = (b) => createHash("sha256").update(b).digest("hex")
  assert.equal(
    hash(Buffer.from(await terrain.arrayBuffer())),
    hash(readFileSync(resolve(repo, "public/assets", terrainName))),
    "terrain bytes",
  )

  // The old address sends a place's link on to the domain.
  const moved = await get(`${OLD_ORIGIN}/place/nova-memorial-reim`)
  assert.equal(moved.status, 301, "old address place link")
  assert.equal(moved.headers.get("location"), `${ORIGIN}/place/nova-memorial-reim`)

  return { at: new Date().toISOString(), sha, tag, passed: true, places: places.length, checks: rows.length, requests: rows }
}
