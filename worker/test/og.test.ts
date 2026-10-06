import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { sweepPhotos, erasePhotos } from "../db/photos"
import { ogResponse, ogState } from "../lib/og"
import { call } from "./app"
import { admin, approve, withSite } from "./helpers"
import { decide, jpeg, queued, send, upload } from "./submission-helpers"

const ogUrl = async (id: string) => {
  const page = await (await call(`http://local/place/${id}`, {}, withSite)).text()
  return /<meta property="og:image" content="([^"]+)"/.exec(page)?.[1]
}
const get = (url: string) => call(url.startsWith("http") ? url : `http://local${url}`)
const files = async (id: string) => (await env.MEDIA.list({ prefix: `og/${id}/` })).objects.map((o) => o.key)
const rev = async (id: string) => (await (await admin(`/api/admin/places/${id}`)).json<{ rev: number }>()).rev
const hide = (placeId: string, fields: string[]) =>
  rev(placeId).then((expectedRev) =>
    admin("/api/admin/suppressions", { method: "POST", body: JSON.stringify({ placeId, fields, expectedRev, reason: "נימוק דמו" }) }),
  )

async function publishedWithPhoto(name: string) {
  const { id, trackingToken } = await send(name, { place_he: "בארי" })
  expect((await upload(id, trackingToken, jpeg(0x5a))).status).toBe(200)
  expect((await decide(id, await queued(id), "approve")).status).toBe(200)
  return { id, trackingToken }
}

describe("a place's own share image (L4)", () => {
  it("is named by the share page, rendered on first request, and served with the photo's cache rules", async () => {
    const { id } = await publishedWithPhoto("גן דמו עם תמונת שיתוף")
    const url = (await ogUrl(id))!
    expect(url).toMatch(new RegExp(`^http://local/media/og/${id}/[0-9a-f]{64}\\.png$`))
    expect(await files(id)).toEqual([])
    const res = await get(url)
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("image/png")
    expect(res.headers.get("Cache-Tag")).toBe(`place:${id}`)
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60")
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(String.fromCharCode(...bytes.slice(1, 4))).toBe("PNG")
    expect(await files(id)).toHaveLength(1)
    // Twice at once: one file, both answered.
    const [a, b] = await Promise.all([get(url), get(url)])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(await files(id)).toHaveLength(1)
  })

  it("never renders for a malformed or a wrong address", async () => {
    const { id } = await publishedWithPhoto("גן דמו כתובת שגויה")
    expect((await get(`/media/og/${id}/zz.png`)).status).toBe(404)
    expect((await get(`/media/og/${id}/${"0".repeat(64)}.png`)).status).toBe(404)
    expect((await get(`/media/og/not-an-id/${"0".repeat(64)}.png`)).status).toBe(404)
    expect(await files(id)).toEqual([])
    // And the renderer is never even called for them.
    let renders = 0
    const counting = async () => (renders++, new Uint8Array())
    for (const h of ["zz", "0".repeat(64), "f".repeat(64)]) await ogResponse({ db: env.DB, media: env.MEDIA }, id, h, counting)
    expect(renders).toBe(0)
  })

  it("follows what the place shows: a hide or a correction retires the old address at once, a lift brings it back", async () => {
    const { id, trackingToken } = await publishedWithPhoto("גן דמו שמשתנה")
    const first = (await ogUrl(id))!
    expect((await get(first)).status).toBe(200)
    expect((await hide(id, ["name_he"])).status).toBe(200)
    const hidden = (await ogUrl(id))!
    expect(hidden).not.toBe(first)
    // Still published, but its old image named what is now hidden.
    expect((await get(first)).status).toBe(404)
    expect((await get(hidden)).status).toBe(200)
    const sid = (await env.DB.prepare("SELECT id FROM field_suppressions WHERE place_id = ? AND lifted_at IS NULL")
      .bind(id)
      .first<string>("id"))!
    const lifted = await admin(`/api/admin/suppressions/${sid}/lift`, {
      method: "POST",
      body: JSON.stringify({
        expectedRev: await rev(id),
        basisCode: "review_supports_restore",
        basisNote: "בדקנו מול אתר המועצה: השם פורסם שם ברשות המשפחה.",
        confirm: { affirmativeBasis: true, notNonresponseOrDispute: true },
      }),
    })
    expect(lifted.status).toBe(200)
    expect(await ogUrl(id)).toBe(first)
    expect((await get(first)).status).toBe(200)
    expect((await get(hidden)).status).toBe(404)

    const status = await (
      await call(`http://local/api/v1/submissions/${id}`, { headers: { Authorization: `Bearer ${trackingToken}` } })
    ).json<{ rev: number }>()
    await call(`http://local/api/v1/submissions/${id}/revisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${trackingToken}`, "Turnstile-Token": "pass-revise" },
      body: JSON.stringify({
        consent_version: "notice.submission@2026-10-13",
        expectedRev: status.rev,
        name_he: "גן דמו שתוקן",
        place_he: "בארי",
      }),
    })
    await approve(id)
    const corrected = (await ogUrl(id))!
    expect(corrected).not.toBe(first)
    expect((await get(first)).status).toBe(404)
    expect((await get(corrected)).status).toBe(200)
  })

  it("is gone with a whole hide or a withdrawal, and its files with the place's", async () => {
    const { id, trackingToken } = await publishedWithPhoto("גן דמו שנמשך עם תמונת שיתוף")
    const url = (await ogUrl(id))!
    expect((await get(url)).status).toBe(200)
    expect((await hide(id, ["whole"])).status).toBe(200)
    expect((await get(url)).status).toBe(404)
    const withdrawn = await call(`http://local/api/v1/submissions/${id}/withdraw`, {
      method: "POST",
      headers: { Authorization: `Bearer ${trackingToken}` },
    })
    expect(withdrawn.status).toBe(200)
    expect(await files(id)).toEqual([])
    // A late write after the withdrawal is the sweep's, an hour on.
    await env.MEDIA.put(`og/${id}/${"a".repeat(64)}.png`, "png")
    await sweepPhotos(env.DB, env.MEDIA, new Date(Date.now() + 2 * 3600_000))
    expect(await files(id)).toEqual([])
  })

  it("an old image of a place still published is swept an hour on; the current one stays", async () => {
    const { id } = await publishedWithPhoto("גן דמו שתמונתו הישנה נסחפת")
    const first = (await ogUrl(id))!
    await get(first)
    expect((await hide(id, ["name_he"])).status).toBe(200)
    const now = (await ogUrl(id))!
    await get(now)
    expect(await files(id)).toHaveLength(2)
    await sweepPhotos(env.DB, env.MEDIA, new Date(Date.now() + 2 * 3600_000))
    expect(await files(id)).toEqual([new URL(now).pathname.replace(/^\/media\//, "")])
    await erasePhotos(env.MEDIA, id)
    expect(await files(id)).toEqual([])
  })

  it("a render that finishes after the place changed returns nothing and leaves nothing", async () => {
    const { id } = await publishedWithPhoto("גן דמו רינדור עצור")
    const url = (await ogUrl(id))!
    const h = url.split("/").pop()!.replace(".png", "")
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let reached!: () => void
    const atRender = new Promise<void>((r) => (reached = r))
    const pending = ogResponse({ db: env.DB, media: env.MEDIA }, id, h, async (...args) => {
      reached()
      await gate
      const { renderOg } = await import("../lib/og")
      return renderOg(...args)
    })
    await atRender
    expect((await hide(id, ["name_he"])).status).toBe(200)
    release()
    expect((await pending).status).toBe(404)
    expect(await files(id)).toEqual([])
  })

  it("a render that fails sends the general image, uncached, and the next request renders", async () => {
    const { id } = await publishedWithPhoto("גן דמו רינדור שנכשל")
    const h = (await ogState(env.DB, id))!.hash
    const failed = await ogResponse({ db: env.DB, media: env.MEDIA }, id, h, async () => {
      throw new Error("renderer down")
    })
    expect(failed.status).toBe(302)
    expect(failed.headers.get("Location")).toBe("/og.png")
    expect(failed.headers.get("Cache-Control")).toBe("no-store")
    expect(failed.headers.get("Cloudflare-CDN-Cache-Control")).toBe("no-store")
    expect(await files(id)).toEqual([])
    expect((await get(`/media/og/${id}/${h}.png`)).status).toBe(200)
  })
})
