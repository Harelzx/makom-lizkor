import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { call } from "./app"
import { admin, withSite } from "./helpers"
import { seedCurated, viewRev } from "./curated-helpers"
import { pixels } from "./png"

// The site's own places read from D1 (phase 7, task 3; adviser a50, P7-OG-1): their share pages carry their public
// fields like a contribution's, name their own share image, go 410 when hidden, and a request about one is stored
// with its origin. Nothing of them is read from the copy the site used to ship.

const page = (id: string) => call(`http://local/place/${encodeURIComponent(id)}`, {}, withSite)
const meta = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1]
const placeData = (html: string) => JSON.parse(/<script type="application\/json" id="place-data">([^<]*)<\/script>/.exec(html)![1])
const hide = async (id: string, fields: string[]) =>
  admin("/api/admin/suppressions", {
    method: "POST",
    body: JSON.stringify({ placeId: id, fields, expectedRev: await viewRev(id), reason: "בדיקת הסתרה בדמו" }),
  })

describe("one of the site's own places, from the database", () => {
  it("has a share page with its fields, photos by the media route, and its own share image", async () => {
    await seedCurated(["community-beeri"])
    const res = await page("community-beeri")
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(meta(html, "og:title")).toBe("בארי")
    const data = placeData(html)
    expect(data).toMatchObject({ id: "community-beeri", kind: "community", curated: { region: "envelope", coord_source: "osm" } })
    expect(data.curated.revival.status).toBeTruthy()
    expect(data.curated.photos).toHaveLength(2)
    for (const p of data.curated.photos) expect(p.url).toMatch(/^\/media\/public\/community-beeri\//)
    const image = meta(html, "og:image")!
    expect(image).toMatch(/^http:\/\/local\/media\/og\/community-beeri\/[0-9a-f]{64}\.png$/)
    const png = await call(image)
    expect(png.status).toBe(200)
    expect(png.headers.get("Content-Type")).toBe("image/png")
    const bytes = new Uint8Array(await png.arrayBuffer())
    expect(String.fromCharCode(...bytes.slice(1, 4))).toBe("PNG")
    // Its photo (the importer's stand-in, a red WebP) fills the panel, not the background it showed without it (P7-OG-1).
    const at = await pixels(bytes)
    for (const y of [40, 315, 590]) expect(at(220, y).map((v, i) => Math.abs(v - [230, 20, 30][i]) <= 24)).toEqual([true, true, true])
  })

  it("is gone (410, not indexed) once hidden whole, and its old share image is refused", async () => {
    await seedCurated(["nova-memorial-reim"])
    const image = meta(await (await page("nova-memorial-reim")).text(), "og:image")!
    expect((await hide("nova-memorial-reim", ["whole"])).status).toBe(200)
    const res = await page("nova-memorial-reim")
    expect(res.status).toBe(410)
    const html = await res.text()
    expect(html).toContain('<meta name="place-status" content="gone"')
    expect(html).not.toContain("רעים")
    expect((await call(image)).status).toBe(404)
  })

  it("takes a hidden photo out of its page and its share image's address", async () => {
    await seedCurated(["community-kfar-aza"])
    const before = await (await page("community-kfar-aza")).text()
    expect(placeData(before).curated.photos.length).toBeGreaterThan(0)
    expect((await hide("community-kfar-aza", ["photo"])).status).toBe(200)
    const after = await (await page("community-kfar-aza")).text()
    expect(placeData(after).curated.photos).toEqual([])
    expect(meta(after, "og:image")).not.toBe(meta(before, "og:image"))
  })

  it("is a 404 page when it was never imported: nothing comes from the site's shipped copy", async () => {
    // One of the shipped places that no test imports.
    expect(await env.DB.prepare("SELECT 1 FROM places WHERE id = 'nova-container-installation'").first()).toBeNull()
    expect((await page("nova-container-installation")).status).toBe(404)
  })
})
