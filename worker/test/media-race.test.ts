import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { placePhoto, runOp, type OpEnv } from "../db/ops"
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
  return { id: s.id, key, held: key.replace(/^public\//, "held/"), bytes }
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

/** The media bucket, with one kind of write on one key held at a gate until the test opens it. */
function gated(op: "put" | "delete", key: string) {
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
          return (target[op] as (...a: unknown[]) => unknown).call(target, k, ...rest)
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
