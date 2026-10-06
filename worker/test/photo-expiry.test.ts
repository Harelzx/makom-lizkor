import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { runRetention } from "../db/retention"
import { decide, jpeg, queued, send, upload } from "./submission-helpers"

// A photo that waited past its days goes, and a moderator's view that still showed it can no longer approve the place
// (adviser 20261006T153309Z-ef1427c3, F5-R8): the photo and the place's rev change in one step, never one then the other.

const DAY = 86_400_000

/** A database whose writes that clear a waiting photo stop, once done, until the test lets them go on. */
function pausingAfterExpiry(db: D1Database) {
  let reached!: () => void
  const atPause = new Promise<void>((r) => (reached = r))
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const matches = (sql: string) => sql.includes("SET photo_key = NULL")
  const sqlOf = new WeakMap<object, string>()
  const real = new WeakMap<object, D1PreparedStatement>()
  const pause = async () => {
    reached()
    await gate
  }
  const wrap = (stmt: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const p = new Proxy(stmt, {
      get(t, prop) {
        if (prop === "bind") return (...args: unknown[]) => wrap(t.bind(...args), sql)
        if (prop === "run")
          return async () => {
            const result = await t.run()
            if (matches(sql)) await pause()
            return result
          }
        const v = Reflect.get(t, prop)
        return typeof v === "function" ? v.bind(t) : v
      },
    })
    sqlOf.set(p, sql)
    real.set(p, stmt)
    return p
  }
  const proxy = new Proxy(db, {
    get(t, prop) {
      if (prop === "prepare") return (sql: string) => wrap(t.prepare(sql), sql)
      if (prop === "batch")
        return async (stmts: D1PreparedStatement[]) => {
          const result = await t.batch(stmts.map((s) => real.get(s) ?? s))
          if (stmts.some((s) => matches(sqlOf.get(s) ?? ""))) await pause()
          return result
        }
      const v = Reflect.get(t, prop)
      return typeof v === "function" ? v.bind(t) : v
    },
  })
  return { db: proxy, atPause, release }
}
const opEnv = (db: D1Database) => ({ db, media: env.MEDIA, ledger: env.LEDGER, purge: async () => true })
const placeRev = (id: string) => env.DB.prepare("SELECT rev FROM places WHERE id = ?").bind(id).first<number>("rev")
const photoOf = (id: string) =>
  env.DB.prepare("SELECT state, photo_key FROM revisions WHERE place_id = ? ORDER BY n DESC")
    .bind(id)
    .first<{ state: string; photo_key: string | null }>()

describe("a waiting photo's expiry against a moderator's decision", () => {
  it("an approval of the view that showed the photo conflicts once the expiry has happened, however far it got", async () => {
    const { id, trackingToken } = await send("גן דמו שתמונתו פגה בזמן ההחלטה")
    expect((await upload(id, trackingToken, jpeg(0x21))).status).toBe(200)
    const view = await queued(id)
    const paused = pausingAfterExpiry(env.DB)
    const expiry = runRetention(opEnv(paused.db), new Date(Date.now() + 30 * DAY))
    await paused.atPause
    // The moderator decides on what they saw, while the expiry is stopped just after its write.
    expect((await decide(id, view, "approve")).status).toBe(409)
    paused.release()
    expect((await expiry).counts.photos).toBe(1)
    expect(await photoOf(id)).toEqual({ state: "pending", photo_key: null })
    expect(await placeRev(id)).toBe(view.rev + 1)
  })

  it("an approval that lands first wins: the photo is published, and the expiry finds nothing to take", async () => {
    const { id, trackingToken } = await send("גן דמו שאושר לפני שתמונתו פגה")
    expect((await upload(id, trackingToken, jpeg(0x22))).status).toBe(200)
    expect((await decide(id, await queued(id), "approve")).status).toBe(200)
    const rev = await placeRev(id)
    expect((await runRetention(opEnv(env.DB), new Date(Date.now() + 30 * DAY))).counts.photos).toBe(0)
    expect(await photoOf(id)).toMatchObject({ state: "approved", photo_key: expect.stringMatching(/^public\//) })
    expect(await placeRev(id)).toBe(rev)
  })
})
