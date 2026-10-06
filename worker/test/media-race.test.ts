import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { placePhoto, resumeOps, runOp, type OpEnv } from "../db/ops"
import { withdraw } from "../db/places"
import { decide, queued, send, upload } from "./submission-helpers"

/** A published place with a photo, as approval leaves it. */
async function withPhoto() {
  const s = await send("ספסל דמו עם תמונה", { place_he: "כיסופים" })
  await upload(s.id, s.trackingToken)
  expect((await decide(s.id, await queued(s.id), "approve")).status).toBe(200)
  const key = (await env.DB.prepare("SELECT r.photo_key FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?")
    .bind(s.id)
    .first<string>("photo_key"))!
  expect(key.startsWith("public/")).toBe(true)
  const bytes = new Uint8Array(await (await env.MEDIA.get(key))!.arrayBuffer())
  return { id: s.id, token: s.trackingToken, key, held: key.replace(/^public\//, "held/"), bytes }
}

let n = 0
/** A photo hide, as a decision's database step leaves it. */
const hidePhoto = (placeId: string) =>
  env.DB.prepare(
    `INSERT INTO field_suppressions (id, place_id, field, kind, created_at, created_by, notes_ceiling_at, notes_purge_after)
     VALUES (?1, ?2, 'photo', 'manual', '2027-01-01T00:00:00.000Z', 'dev@example.test', '2028-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z')`,
  )
    .bind(`s_race_${++n}`, placeId)
    .run()
/** A restoration of every photo hide on the place, as its database step leaves it. */
const liftAll = (placeId: string) =>
  env.DB.prepare(
    "UPDATE field_suppressions SET lifted_at = '2027-01-02T00:00:00.000Z', basis_code = 'review_supports_restore', basis_note = 'דמו' WHERE place_id = ? AND lifted_at IS NULL",
  )
    .bind(placeId)
    .run()

/**
 * The media bucket, with one kind of write on one key held at a gate until the test opens it. With `dies`, the write
 * lands and then the Worker making it stops: nothing after it in that call runs.
 */
function gated(op: "put" | "delete", key: string, dies = false) {
  let open!: () => void
  const gate = new Promise<void>((r) => (open = r))
  let reached = 0
  let arrived!: () => void
  const arrival = new Promise<void>((r) => (arrived = r))
  const media = new Proxy(env.MEDIA, {
    get(target, prop) {
      if (prop === op)
        return async (k: string, ...rest: unknown[]) => {
          if (k === key) {
            reached += 1
            arrived()
            await gate
          }
          const result = await (target[op] as (...a: unknown[]) => Promise<unknown>).call(target, k, ...rest)
          if (dies && k === key) throw new Error("worker stopped")
          return result
        }
      const value = Reflect.get(target, prop)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  return { media, open, arrival, reached: () => reached }
}
const opEnv = (media: R2Bucket = env.MEDIA): OpEnv => ({ db: env.DB, media, ledger: env.LEDGER, purge: async () => true })
const stored = async (key: string) => {
  const o = await env.MEDIA.get(key)
  return o ? new Uint8Array(await o.arrayBuffer()) : null
}

describe("moving a photo between public and held while decisions overlap (F4-O2)", () => {
  it("an older hide's delete of the public copy that lands after a restoration finished: the photo is served again, and never lost", async () => {
    const p = await withPhoto()
    await hidePhoto(p.id)
    const late = gated("delete", p.key)
    const hiding = placePhoto(opEnv(late.media), p.id)
    await late.arrival
    // The restoration lands and finishes completely while the hide's delete is still on its way.
    await liftAll(p.id)
    await placePhoto(opEnv(), p.id)
    late.open()
    await hiding
    expect(late.reached()).toBe(1)
    expect(await stored(p.key)).toEqual(p.bytes)
    expect(await stored(p.held)).toEqual(p.bytes)
  })

  it("the reverse: a restoration's public copy that lands after a newer hide finished is taken down again, and the held copy stays", async () => {
    const p = await withPhoto()
    await hidePhoto(p.id)
    await placePhoto(opEnv(), p.id)
    expect(await stored(p.key)).toBeNull()
    await liftAll(p.id)
    const late = gated("put", p.key)
    const restoring = placePhoto(opEnv(late.media), p.id)
    await late.arrival
    // A newer hide lands and finishes while the restoration's copy is still on its way.
    await hidePhoto(p.id)
    await placePhoto(opEnv(), p.id)
    late.open()
    await restoring
    expect(late.reached()).toBe(1)
    expect(await stored(p.key)).toBeNull()
    expect(await stored(p.held)).toEqual(p.bytes)
  })

  it("a refused restoration's cleanup whose delete lands after the winning restoration finished leaves the photo served", async () => {
    const p = await withPhoto()
    await hidePhoto(p.id)
    await placePhoto(opEnv(), p.id)
    const { rev } = (await env.DB.prepare("SELECT rev FROM places WHERE id = ?").bind(p.id).first<{ rev: number }>())!
    const late = gated("delete", p.key)
    const loser = runOp(
      opEnv(late.media),
      {
        placeId: p.id,
        kind: "lift",
        actor: "moderator",
        expectedRev: rev,
        removal: false,
        public: true,
        onIntentFailure: "refuse",
        // As a restoration does: the held file is copied back before the decision.
        prepare: async () => {
          await env.MEDIA.put(p.key, (await env.MEDIA.get(p.held))!.body)
          return { prepared: [p.key], media: [p.key] }
        },
        // It loses its race: the compare-and-set finds the place moved on.
        statements: (tid) => [env.DB.prepare("UPDATE places SET last_transition_id = ?2 WHERE id = ?1 AND 0").bind(p.id, tid)],
      },
      new Date(),
    )
    await late.arrival
    // The winning restoration lands and finishes while the loser's cleanup delete is still on its way.
    await liftAll(p.id)
    await placePhoto(opEnv(), p.id)
    late.open()
    expect((await loser).outcome).toBe("conflict")
    expect(late.reached()).toBe(1)
    expect(await stored(p.key)).toEqual(p.bytes)
    expect(await stored(p.held)).toEqual(p.bytes)
  })
})

describe("a late write whose Worker then stopped is put right by the scheduled job, with no other decision (F4-O2)", () => {
  const afterSettling = () => new Date(Date.now() + 3 * 60_000)
  const due = (placeId: string) =>
    env.DB.prepare("SELECT due_at FROM media_checks WHERE place_id = ?").bind(placeId).first<string>("due_at")

  it("a hide's delete lands after the restoration finished, and the hide's Worker stops: the job serves the photo again", async () => {
    const p = await withPhoto()
    await hidePhoto(p.id)
    const late = gated("delete", p.key, true)
    const hiding = placePhoto(opEnv(late.media), p.id).catch((err: Error) => err)
    await late.arrival
    await liftAll(p.id)
    await placePhoto(opEnv(), p.id)
    late.open()
    expect(String(await hiding)).toContain("worker stopped")
    // The restoration is recorded as done, yet the photo it serves is gone: only the held copy is left.
    expect(await stored(p.key)).toBeNull()
    await resumeOps(opEnv(), afterSettling())
    expect(await stored(p.key)).toEqual(p.bytes)
    expect(await stored(p.held)).toEqual(p.bytes)
    // The watch stays, looking again later: a write still on its way may land after this look.
    expect(await due(p.id)).not.toBeNull()
  })

  it("the reverse: a restoration's copy lands after a newer hide finished, and its Worker stops: the job takes it down", async () => {
    const p = await withPhoto()
    await hidePhoto(p.id)
    await placePhoto(opEnv(), p.id)
    await liftAll(p.id)
    const late = gated("put", p.key, true)
    const restoring = placePhoto(opEnv(late.media), p.id).catch((err: Error) => err)
    await late.arrival
    await hidePhoto(p.id)
    await placePhoto(opEnv(), p.id)
    late.open()
    expect(String(await restoring)).toContain("worker stopped")
    expect(await stored(p.key)).toEqual(p.bytes)
    await resumeOps(opEnv(), afterSettling())
    expect(await stored(p.key)).toBeNull()
    expect(await stored(p.held)).toEqual(p.bytes)
  })

  it("a refused restoration whose cleanup delete lands late and whose Worker stops: the job serves the photo, and the cleanup is recorded done", async () => {
    const p = await withPhoto()
    await hidePhoto(p.id)
    await placePhoto(opEnv(), p.id)
    const { rev } = (await env.DB.prepare("SELECT rev FROM places WHERE id = ?").bind(p.id).first<{ rev: number }>())!
    const late = gated("delete", p.key, true)
    const loser = runOp(
      opEnv(late.media),
      {
        placeId: p.id,
        kind: "lift",
        actor: "moderator",
        expectedRev: rev,
        removal: false,
        public: true,
        onIntentFailure: "refuse",
        prepare: async () => {
          await env.MEDIA.put(p.key, (await env.MEDIA.get(p.held))!.body)
          return { prepared: [p.key], media: [p.key] }
        },
        statements: (tid) => [env.DB.prepare("UPDATE places SET last_transition_id = ?2 WHERE id = ?1 AND 0").bind(p.id, tid)],
      },
      new Date(),
    )
    await late.arrival
    await liftAll(p.id)
    await placePhoto(opEnv(), p.id)
    late.open()
    const { id } = await loser
    expect(await stored(p.key)).toBeNull()
    expect(await env.DB.prepare("SELECT media FROM visibility_ops WHERE id = ?").bind(id).first("media")).toBe("failed")
    await resumeOps(opEnv(), afterSettling())
    expect(await stored(p.key)).toEqual(p.bytes)
    expect(await env.DB.prepare("SELECT media FROM visibility_ops WHERE id = ?").bind(id).first("media")).toBe("done")
  })

  it("a served photo with no copy left anywhere is a failure that stays visible, never a completed move", async () => {
    const p = await withPhoto()
    await env.MEDIA.delete([p.key, p.held])
    await expect(placePhoto(opEnv(), p.id)).rejects.toThrow("photo_missing")
    await resumeOps(opEnv(), afterSettling())
    // Still due: the job keeps looking, later, rather than forgetting it.
    expect(await due(p.id)).not.toBeNull()
  })
})

describe("the photo watch outlasts any one look (F4-O2)", () => {
  const t0 = Date.now()
  const at = (minutes: number) => new Date(t0 + minutes * 60_000)
  const due = (placeId: string) =>
    env.DB.prepare("SELECT due_at FROM media_checks WHERE place_id = ?").bind(placeId).first<string>("due_at")
  // Each test runs its jobs on its own stretch of time, after the previous test's.
  let base = 0
  const next = () => (base += 24 * 60)

  it("a hide's delete held across a completed look, then landing as its Worker stops: a later scheduled look serves the photo again", async () => {
    const t = next()
    const p = await withPhoto()
    await hidePhoto(p.id)
    const late = gated("delete", p.key, true)
    const hiding = placePhoto(opEnv(late.media), p.id, at(t)).catch((err: Error) => err)
    await late.arrival
    await liftAll(p.id)
    await placePhoto(opEnv(), p.id, at(t))
    // The job looks while the delete is still on its way, and finds everything in place.
    await resumeOps(opEnv(), at(t + 3))
    expect(await stored(p.key)).toEqual(p.bytes)
    late.open()
    expect(String(await hiding)).toContain("worker stopped")
    expect(await stored(p.key)).toBeNull()
    await resumeOps(opEnv(), at(t + 30))
    expect(await stored(p.key)).toBeNull()
    await resumeOps(opEnv(), at(t + 3 + 61))
    expect(await stored(p.key)).toEqual(p.bytes)
    expect(await stored(p.held)).toEqual(p.bytes)
  })

  it("the reverse: a restoration's copy held across a completed look, then landing as its Worker stops: a later look takes it down", async () => {
    const t = next()
    const p = await withPhoto()
    await hidePhoto(p.id)
    await placePhoto(opEnv(), p.id, at(t))
    await liftAll(p.id)
    const late = gated("put", p.key, true)
    const restoring = placePhoto(opEnv(late.media), p.id, at(t)).catch((err: Error) => err)
    await late.arrival
    await hidePhoto(p.id)
    await placePhoto(opEnv(), p.id, at(t))
    await resumeOps(opEnv(), at(t + 3))
    late.open()
    expect(String(await restoring)).toContain("worker stopped")
    expect(await stored(p.key)).toEqual(p.bytes)
    await resumeOps(opEnv(), at(t + 3 + 61))
    expect(await stored(p.key)).toBeNull()
    expect(await stored(p.held)).toEqual(p.bytes)
  })

  it("a look's own copy landing late, after a newer hide, as the job's Worker stops: the next look takes it down", async () => {
    const t = next()
    const p = await withPhoto()
    await hidePhoto(p.id)
    await placePhoto(opEnv(), p.id, at(t))
    // Restored in the database, with the copy back in view left to the job.
    await liftAll(p.id)
    const late = gated("put", p.key, true)
    const looking = resumeOps(opEnv(late.media), at(t + 3))
    await late.arrival
    // While its own write is still on its way, the job has already booked its next look.
    expect(await due(p.id)).toBe(at(t + 3 + 60).toISOString())
    await hidePhoto(p.id)
    await placePhoto(opEnv(), p.id, at(t + 3))
    late.open()
    await looking
    expect(late.reached()).toBe(1)
    expect(await stored(p.key)).toEqual(p.bytes)
    await resumeOps(opEnv(), at(t + 3 + 61))
    expect(await stored(p.key)).toBeNull()
    expect(await stored(p.held)).toEqual(p.bytes)
  })

  it("a place whose photo is gone for good (withdrawn) leaves the watch, and nothing is copied back", async () => {
    const t = next()
    const p = await withPhoto()
    await placePhoto(opEnv(), p.id, at(t))
    expect(await due(p.id)).not.toBeNull()
    await env.DB.prepare("UPDATE places SET status = 'withdrawn' WHERE id = ?").bind(p.id).run()
    await env.MEDIA.delete([p.key, p.held])
    await resumeOps(opEnv(), at(t + 3))
    expect(await due(p.id)).toBeNull()
    expect(await stored(p.key)).toBeNull()
    expect(await stored(p.held)).toBeNull()
  })
})

describe("a withdrawal's files are erased by the job too, whatever the request managed (F4-O2)", () => {
  const t0 = Date.now() + 30 * 24 * 60 * 60_000
  const at = (minutes: number) => new Date(t0 + minutes * 60_000)
  const due = (placeId: string) =>
    env.DB.prepare("SELECT due_at FROM media_checks WHERE place_id = ?").bind(placeId).first<string>("due_at")

  it("a withdrawal whose request stopped before erasing, and a copy landing after it: both erased by the job, then the watch ends", async () => {
    const p = await withPhoto()
    expect(await withdraw(opEnv(), p.id, p.token, at(0))).toBe("done")
    // The withdrawal is stored, and the place is already on the watch, in the same step.
    expect(await due(p.id)).not.toBeNull()
    // As if the request stopped before its erasure, and an older move's copy landed afterwards.
    await env.MEDIA.put(p.held, p.bytes)
    expect(await stored(p.key)).toEqual(p.bytes)
    await resumeOps(opEnv(), at(3))
    expect(await stored(p.key)).toBeNull()
    expect(await stored(p.held)).toBeNull()
    // It found files, so it looks once more before letting go.
    expect(await due(p.id)).not.toBeNull()
    await resumeOps(opEnv(), at(3 + 61))
    expect(await due(p.id)).toBeNull()
  })
})
