import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { sweepPhotos } from "../db/photos"
import { runJobs } from "../jobs"
import { sendMail } from "../lib/mail"
import { call } from "./app"
import { decide, objects, queued, send, upload } from "./submission-helpers"

// Two hours on: every file written by the test is past the sweep's settling age.
const later = () => new Date(Date.now() + 2 * 3600 * 1000)
const deps = { sendMail, purge: async () => true }

async function published(name: string) {
  const { id, trackingToken } = await send(name)
  expect((await upload(id, trackingToken)).status).toBe(200)
  expect((await decide(id, await queued(id), "approve")).status).toBe(200)
  const key = (await env.DB.prepare(
    "SELECT r.photo_key AS key FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?",
  )
    .bind(id)
    .first<{ key: string }>())!.key
  expect(key).toMatch(/^public\//)
  // Each test watches only its own place: the approval's photo watch is the job's, not this test's.
  await env.DB.prepare("DELETE FROM media_checks WHERE place_id = ?").bind(id).run()
  return { id, trackingToken, key }
}

describe("the photo sweep", () => {
  it("keeps the held twin of a live photo, and removes held files nothing names", async () => {
    const { id, key } = await published("גן דמו עם תאום מוסתר")
    const twin = key.replace(/^public\//, "held/")
    await env.MEDIA.put(twin, "jpeg")
    await env.MEDIA.put(`held/${id}/stray.jpg`, "jpeg")
    await sweepPhotos(env.DB, env.MEDIA, later())
    expect((await objects(id)).sort()).toEqual([twin, key].sort())
  })

  it("leaves a place's files alone while an operation on it is unfinished, then sweeps them", async () => {
    const { id } = await published("גן דמו עם פעולה פתוחה")
    const stray = `public/${id}/copy-in-flight.jpg`
    await env.MEDIA.put(stray, "jpeg")
    // An approval's copy is written before the decision names it: while the operation is open, it isn't stray.
    await env.DB.prepare(
      `INSERT INTO visibility_ops (id, place_id, kind, actor, removal, expected_rev, seq_from, detail, state, intent, media, ledger_commit,
         purge, created_at, updated_at)
       VALUES (?, ?, 'approve', 'moderator', 0, 1, 0, '{}', 'pending', 'pending', 'none', 'pending', 'none', ?, ?)`,
    )
      .bind(`op_${crypto.randomUUID()}`, id, new Date().toISOString(), new Date().toISOString())
      .run()
    await sweepPhotos(env.DB, env.MEDIA, later())
    expect(await objects(id)).toContain(stray)
    await env.DB.prepare("UPDATE visibility_ops SET state = 'applied', ledger_commit = 'written' WHERE place_id = ?").bind(id).run()
    // A standing photo watch holds nothing back: a move only writes the twin of the live photo, which is kept.
    await env.DB.prepare("INSERT INTO media_checks (place_id, due_at) VALUES (?, ?)").bind(id, new Date().toISOString()).run()
    await sweepPhotos(env.DB, env.MEDIA, later())
    expect(await objects(id)).not.toContain(stray)
  })

  it("leaves a file younger than an hour alone (an upload being recorded)", async () => {
    const { id } = await published("גן דמו עם העלאה טרייה")
    const young = `quarantine/${id}/just-written.jpg`
    await env.MEDIA.put(young, "jpeg")
    await sweepPhotos(env.DB, env.MEDIA, new Date())
    expect(await objects(id)).toContain(young)
  })

  it("removes a file that lands for a withdrawn place after its watch ended (F4-R10), whatever is still recorded for it", async () => {
    const { id, trackingToken } = await published("גן דמו שנמשך")
    const withdrawn = await call(`http://local/api/v1/submissions/${id}/withdraw`, {
      method: "POST",
      headers: { Authorization: `Bearer ${trackingToken}` },
    })
    expect(withdrawn.status).toBe(200)
    await env.DB.prepare("DELETE FROM media_checks WHERE place_id = ?").bind(id).run()
    await env.MEDIA.put(`public/${id}/late-move.jpg`, "jpeg")
    await env.MEDIA.put(`held/${id}/late-move.jpg`, "jpeg")
    await sweepPhotos(env.DB, env.MEDIA, later())
    expect(await objects(id)).toEqual([])
  })

  it("runs on its own in the scheduled pass", async () => {
    const { id, key } = await published("גן דמו בהרצה המתוזמנת")
    const stray = `quarantine/${id}/forgotten.jpg`
    await env.MEDIA.put(stray, "jpeg")
    await runJobs(env, deps, undefined, later())
    expect(await objects(id)).toEqual([key])
  })
})
