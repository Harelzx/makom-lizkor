import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import type { Element } from "@/shared/contract"
import { call } from "./app"
import { admin, withSite } from "./helpers"
import { decide, feed, queued, send, upload } from "./submission-helpers"

/** A published place with every field the public sees, a photo included. */
async function full() {
  const s = await send("ספסל דמו לזכר דני", {
    place_he: "בארי",
    in_memory_of: "דני דמו",
    story_he: "דני אהב לשבת כאן עם הכלב שלו בשקיעה.",
  })
  expect((await upload(s.id, s.trackingToken)).status).toBe(200)
  expect((await decide(s.id, await queued(s.id), "approve")).status).toBe(200)
  return s.id
}
const placeView = async (id: string) =>
  (await (await admin(`/api/admin/places/${id}`)).json<{ rev: number; status: string; photo_key: string | null }>()) as {
    rev: number
    status: string
    photo_key: string | null
  }
async function hide(id: string, fields: Element[]) {
  const { rev } = await placeView(id)
  const res = await admin("/api/admin/suppressions", {
    method: "POST",
    body: JSON.stringify({ placeId: id, fields, expectedRev: rev, reason: "בדיקה" }),
  })
  expect(res.status).toBe(200)
}
const inFeed = async (id: string) => (await feed()).find((p) => p.id === id)
const sharePage = async (id: string) => {
  const res = await call(`http://local/place/${id}`, {}, withSite)
  return { status: res.status, html: await res.text(), headers: res.headers }
}

describe("what the public sees of a place with hidden elements", () => {
  it("a hidden name reads as its kind and community, in the feed and on the share page, and the name appears nowhere", async () => {
    const id = await full()
    await hide(id, ["name_he"])
    expect((await inFeed(id))!.name_he).toBe("ספסל · בארי")
    const page = await sharePage(id)
    expect(page.status).toBe(200)
    expect(page.html).toContain("ספסל · בארי")
    expect(page.html).not.toContain("לזכר דני")
  })

  it("a hidden story leaves an empty summary; a hidden dedication is left out", async () => {
    const id = await full()
    await hide(id, ["story_he", "in_memory_of"])
    const p = (await inFeed(id))!
    expect(p.summary_he).toBe("")
    expect(p).not.toHaveProperty("in_memory_of")
    expect((await sharePage(id)).html).not.toContain("עם הכלב שלו")
  })

  it("a hidden photo is not named, not served, and its file waits in held/", async () => {
    const id = await full()
    const { photo_key } = await placeView(id)
    expect(photo_key).toMatch(/^public\//)
    expect((await call(`http://local/media/${photo_key}`)).status).toBe(200)
    await hide(id, ["photo"])
    expect((await inFeed(id))!).not.toHaveProperty("photo")
    expect((await call(`http://local/media/${photo_key}`)).status).toBe(404)
    expect(await env.MEDIA.head(photo_key!)).toBeNull()
    expect(await env.MEDIA.head(photo_key!.replace(/^public\//, "held/"))).not.toBeNull()
  })

  it("the whole place hidden: out of the feed and the anemone totals, its share page gone (410, not indexed), its photo not served", async () => {
    const id = await full()
    const { photo_key } = await placeView(id)
    await hide(id, ["whole"])
    expect(await inFeed(id)).toBeUndefined()
    const page = await sharePage(id)
    expect(page.status).toBe(410)
    expect(page.headers.get("Cache-Control")).toBe("no-store")
    expect(page.headers.get("X-Robots-Tag")).toBe("noindex")
    expect(page.html).not.toContain("לזכר דני")
    expect((await call(`http://local/media/${photo_key}`)).status).toBe(404)
    const totals = await (await call("http://local/api/v1/tributes")).json<{ totals: Record<string, number> }>()
    expect(totals.totals).not.toHaveProperty(id)
  })
})

describe("a published photo's caching (spec 5)", () => {
  it("a minute in the browser and at the edge, tagged with its place so a takedown purges it", async () => {
    const id = await full()
    const { photo_key } = await placeView(id)
    const res = await call(`http://local/media/${photo_key}`)
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60")
    expect(res.headers.get("Cloudflare-CDN-Cache-Control")).toBe("max-age=60")
    expect(res.headers.get("Cache-Tag")).toBe(`place:${id}`)
  })
})

describe("review findings", () => {
  it("with the name or the dedication hidden, the photo's description and the link can't repeat them (F4-R9)", async () => {
    const s = await send("ספסל דמו לזכר רונית", { place_he: "בארי", link_url: "https://example.test/ronit" })
    await upload(s.id, s.trackingToken)
    await decide(s.id, await queued(s.id), "approve")
    await hide(s.id, ["name_he"])
    const p = (await inFeed(s.id))! as { photo?: { alt: string }; link_url?: string }
    expect(p.photo!.alt).toBe("ספסל · בארי")
    expect(p).not.toHaveProperty("link_url")
  })
})
