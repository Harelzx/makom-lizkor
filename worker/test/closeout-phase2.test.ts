// Regression tests for the adviser's close-out of phase 2 (consultation 20261005T200200Z-1838ed8c).
import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { CURRENT_SUBMISSION_NOTICE } from "@/shared/contract"
import { sweepPhotos } from "../db/places"
import { call } from "./app"
import { decide, feed, jpeg, objects, queued, rev, revise, send, upload } from "./submission-helpers"

/** A bucket whose writes wait until released: the moment between a copy and the decision, held open. */
function heldPuts(media: R2Bucket) {
  let release!: () => void
  let reached!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const atPut = new Promise<void>((r) => (reached = r))
  const bucket = new Proxy(media, {
    get(target, prop) {
      if (prop === "put")
        return async (...args: Parameters<R2Bucket["put"]>) => {
          reached()
          await gate
          return target.put(...args)
        }
      const value = Reflect.get(target, prop)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  return { bucket, release, atPut }
}

/** A bucket that stores but can't list or delete: a cleanup that fails after the decision is stored. */
function failingCleanup(media: R2Bucket) {
  return new Proxy(media, {
    get(target, prop) {
      if (prop === "delete" || prop === "list")
        return async () => {
          throw new Error("r2 down")
        }
      const value = Reflect.get(target, prop)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

const withdraw = (id: string, token: string) =>
  call(`http://local/api/v1/submissions/${id}/withdraw`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })
const publicKeys = async (id: string) => (await objects(id)).filter((k) => k.startsWith("public/"))
// The sweep keeps anything younger than this, so a copy an approval is about to record is never taken.
const later = () => new Date(Date.now() + 2 * 3600 * 1000)

describe("phase 2 close-out", () => {
  it("#12 an approval whose copy lands after a withdrawal leaves no photo anyone can fetch", async () => {
    const { id, trackingToken } = await send("ספסל דמו אישור ומשיכה")
    await upload(id, trackingToken)
    const item = await queued(id)
    const held = heldPuts(env.MEDIA)
    // The copy to public/ is held; meanwhile the sender withdraws, and the cleanup after the lost race fails too.
    const approving = decide(id, item, "approve", undefined, { ...env, MEDIA: held.bucket })
    await held.atPut
    expect((await withdraw(id, trackingToken)).status).toBe(200)
    held.release()
    expect((await approving).status).toBe(409)
    for (const key of await publicKeys(id)) expect((await call(`http://local/media/${key}`)).status).toBe(404)
    expect(await objects(id)).toHaveLength(0)
  })

  it("#12 a stray public file that cleanup couldn't remove is never served, and the sweep removes it", async () => {
    const { id, trackingToken } = await send("ספסל דמו קובץ תועה")
    await upload(id, trackingToken)
    const item = await queued(id)
    const held = heldPuts(failingCleanup(env.MEDIA))
    const approving = decide(id, item, "approve", undefined, { ...env, MEDIA: held.bucket })
    await held.atPut
    await withdraw(id, trackingToken)
    held.release()
    expect((await approving).status).toBe(409)
    // The withdrawal ran before the copy landed, and the loser's cleanup failed: one file is left behind.
    const [stray] = await publicKeys(id)
    expect(stray).toBeTruthy()
    expect((await call(`http://local/media/${stray}`)).status).toBe(404)
    await sweepPhotos(env.DB, env.MEDIA, later())
    expect(await objects(id)).toHaveLength(0)
  })

  it("#12 a photo whose upload lands after a withdrawal is neither kept nor tied to the erased revision", async () => {
    const { id, trackingToken } = await send("ספסל דמו העלאה ומשיכה")
    const held = heldPuts(env.MEDIA)
    const form = new FormData()
    form.append("photo", new File([jpeg()], "p.jpg", { type: "image/jpeg" }))
    form.append("alt", "תיאור דמו")
    form.append("credit", "צלם דמו")
    const encoded = new Request("http://local/", { method: "PUT", body: form })
    const body = await encoded.arrayBuffer()
    const uploading = call(
      `http://local/api/v1/submissions/${id}/photo`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${trackingToken}`,
          "Content-Type": encoded.headers.get("Content-Type")!,
          "Content-Length": String(body.byteLength),
        },
        body,
      },
      { ...env, MEDIA: held.bucket },
    )
    await held.atPut
    await withdraw(id, trackingToken)
    held.release()
    expect((await uploading).status).toBe(409)
    const row = await env.DB.prepare("SELECT photo_key, photo_alt, photo_credit FROM revisions WHERE place_id = ?").bind(id).first()
    expect(row).toEqual({ photo_key: null, photo_alt: null, photo_credit: null })
    expect(await objects(id)).toHaveLength(0)
  })

  it("#10 a decision stored before the file cleanup fails is reported as made, and the sweep finishes the cleanup", async () => {
    const { id, trackingToken } = await send("ספסל דמו ניקוי נכשל")
    await upload(id, trackingToken)
    await env.MEDIA.put(`quarantine/${id}/leftover.jpg`, jpeg())
    const res = await decide(id, await queued(id), "approve", undefined, { ...env, MEDIA: failingCleanup(env.MEDIA) })
    expect(res.status).toBe(200)
    const published = (await feed()).find((p) => p.id === id)!
    expect(published.photo).toBeTruthy()
    expect((await objects(id)).some((k) => k.startsWith("quarantine/"))).toBe(true)
    await sweepPhotos(env.DB, env.MEDIA, later())
    expect(await objects(id)).toEqual([(published.photo as { url: string }).url.replace(/^\/media\//, "")])
    expect((await call(`http://local${(published.photo as { url: string }).url}`)).status).toBe(200)
  })

  it("the sweep leaves a copy younger than an hour alone: an approval may be about to record it", async () => {
    const { id } = await send("ספסל דמו העתק טרי")
    await env.MEDIA.put(`public/${id}/r_fresh.jpg`, jpeg())
    await sweepPhotos(env.DB, env.MEDIA, new Date())
    expect(await publicKeys(id)).toHaveLength(1)
  })
})

describe("the review queue's capacity", () => {
  const pending = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM revisions WHERE state = 'pending'").first<number>("n"))!
  const submitTo = (e: Env, name: string, key = crypto.randomUUID().replaceAll("-", "")) =>
    call(
      "http://local/api/v1/submissions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key, "Turnstile-Token": "pass" },
        body: JSON.stringify({ kind: "bench", name_he: name, lat: 31.42, lng: 34.49, consent_version: CURRENT_SUBMISSION_NOTICE }),
      },
      e,
    )

  it("submissions sent at the same moment never fill it past its limit", async () => {
    const e = { ...env, QUEUE_LIMIT: String((await pending()) + 1) }
    const results = await Promise.all([1, 2, 3, 4, 5].map((i) => submitTo(e, `ספסל דמו תור מקביל ${i}`)))
    expect(results.filter((r) => r.status === 201)).toHaveLength(1)
    expect(results.filter((r) => r.status === 503)).toHaveLength(4)
  })

  it("a submission sent again while the queue is full still gets its first answer", async () => {
    const key = crypto.randomUUID().replaceAll("-", "")
    const first = await submitTo(env, "ספסל דמו חזרה בתור מלא", key)
    const e = { ...env, QUEUE_LIMIT: String(await pending()) }
    const again = await submitTo(e, "ספסל דמו חזרה בתור מלא", key)
    expect(again.status).toBe(200)
    expect((await again.json<{ id: string }>()).id).toBe((await first.json<{ id: string }>()).id)
  })

  it("a correction waits for room in the queue like a new submission", async () => {
    const { id, trackingToken } = await send("ספסל דמו תיקון בתור מלא")
    await decide(id, await queued(id), "approve")
    const e = { ...env, QUEUE_LIMIT: String(await pending()) }
    const res = await call(
      `http://local/api/v1/submissions/${id}/revisions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${trackingToken}`, "Turnstile-Token": "pass-revise" },
        body: JSON.stringify({
          expectedRev: await rev(id, trackingToken),
          name_he: "ספסל דמו לא ייכנס",
          consent_version: CURRENT_SUBMISSION_NOTICE,
        }),
      },
      e,
    )
    expect(res.status).toBe(503)
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM revisions WHERE place_id = ? AND state = 'pending'").bind(id).first("n")).toBe(0)
  })

  it("#22 a second correction while one is pending is refused, at once or concurrently, and the published text stays", async () => {
    const { id, trackingToken } = await send("ספסל דמו שני תיקונים")
    await decide(id, await queued(id), "approve")
    const at = await rev(id, trackingToken)
    const both = await Promise.all([revise(id, trackingToken, at, "ספסל דמו תיקון א"), revise(id, trackingToken, at, "ספסל דמו תיקון ב")])
    expect(both.map((r) => r.status).sort()).toEqual([200, 409])
    expect((await revise(id, trackingToken, await rev(id, trackingToken), "ספסל דמו תיקון ג")).status).toBe(409)
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM revisions WHERE place_id = ? AND state = 'pending'").bind(id).first("n")).toBe(1)
    expect((await feed()).find((p) => p.id === id)).toMatchObject({ name_he: "ספסל דמו שני תיקונים" })
  })
})
