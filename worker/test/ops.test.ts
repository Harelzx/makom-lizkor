import { env } from "cloudflare:workers"
import { beforeEach, describe, expect, it } from "vitest"
import { ledgerKey, type LedgerEntry } from "../lib/ledger"
import { resumeOps, runOp, type OpEnv, type OpSpec } from "../db/ops"
import { approve, submit } from "./helpers"

const now = new Date("2026-10-06T08:00:00.000Z")
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000)

/** A published place, its rev and decision step as they are now. */
async function published() {
  const { id } = await submit("גינת דמו")
  await approve(id)
  return { id, ...(await place(id)) }
}
const place = (id: string) =>
  env.DB.prepare("SELECT rev, ledger_seq, status FROM places WHERE id = ?")
    .bind(id)
    .first<{ rev: number; ledger_seq: number; status: string }>() as Promise<{
    rev: number
    ledger_seq: number
    status: string
  }>
const op = (id: string) => env.DB.prepare("SELECT * FROM visibility_ops WHERE id = ?").bind(id).first<Record<string, string | number>>()
const entryOf = async (key: string) => (await env.LEDGER.get(key))?.json<LedgerEntry>()

/** Hides a place: the simplest decision that changes what the public sees. */
function hide(placeId: string, expectedRev: number, extra: Partial<OpSpec> = {}): OpSpec {
  return {
    placeId,
    kind: "suppress",
    actor: "moderator",
    expectedRev,
    removal: true,
    public: true,
    onIntentFailure: "proceed",
    detail: { fields: ["whole"] },
    statements: (tid) => [
      env.DB.prepare(
        "UPDATE places SET status = 'hidden', rev = rev + 1, last_transition_id = ?2 WHERE id = ?1 AND rev = ?3 AND status = 'published'",
      ).bind(placeId, tid, expectedRev),
    ],
    ...extra,
  }
}

let purged: string[][]
let opEnv: OpEnv
beforeEach(() => {
  purged = []
  opEnv = { db: env.DB, media: env.MEDIA, ledger: env.LEDGER, purge: async (tags) => (purged.push(tags), true) }
})

/** A bucket that refuses the writes `refuse` says no to, and passes everything else through. */
function refusing(refuse: (key: string) => boolean): R2Bucket {
  return new Proxy(env.LEDGER, {
    get(target, prop) {
      if (prop === "put")
        return (key: string, ...rest: unknown[]) =>
          refuse(key) ? Promise.reject(new Error("down")) : target.put(key, ...(rest as [string]))
      const value = Reflect.get(target, prop)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

describe("a decision as a durable operation", () => {
  it("is stored with its expected rev before the intent is written, and the intent is in the ledger before the database changes", async () => {
    const p = await published()
    const seen: string[] = []
    const ledger = new Proxy(env.LEDGER, {
      get(target, prop) {
        if (prop === "put")
          return async (key: string, value: string) => {
            const row = await env.DB.prepare("SELECT expected_rev FROM visibility_ops WHERE place_id = ? AND state = 'pending'")
              .bind(p.id)
              .first()
            seen.push(`put ${key.endsWith("intent.json") ? "intent" : "commit"} op-stored=${!!row}`)
            return target.put(key, value)
          }
        const value = Reflect.get(target, prop)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    const db = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "batch")
          return async (stmts: D1PreparedStatement[]) => {
            const listed = await env.LEDGER.list({ prefix: `ledger/${p.id}/` })
            seen.push(
              `batch intent-present=${listed.objects.some((o) => o.key.endsWith("intent.json") && o.key.includes(`${String(p.ledger_seq).padStart(8, "0")}-`))}`,
            )
            return target.batch(stmts)
          }
        const value = Reflect.get(target, prop)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    const result = await runOp({ ...opEnv, db, ledger }, hide(p.id, p.rev), now)
    expect(result.outcome).toBe("ok")
    expect(seen).toEqual(["put intent op-stored=true", "batch intent-present=true", "put commit op-stored=false"])
  })

  it("moves the place's chain one step with the decision, and commits what actually happened", async () => {
    const p = await published()
    const { id } = await runOp(opEnv, hide(p.id, p.rev), now)
    const after = await place(p.id)
    expect(after).toMatchObject({ status: "hidden", rev: p.rev + 1, ledger_seq: p.ledger_seq + 1 })
    const commit = await entryOf(ledgerKey({ place: p.id, seq_from: p.ledger_seq, op: id!, phase: "commit" }))
    expect(commit).toMatchObject({
      kind: "suppress",
      seq_from: p.ledger_seq,
      seq_to: p.ledger_seq + 1,
      rev_from: p.rev,
      rev_to: p.rev + 1,
      status: "hidden",
    })
    expect(commit).toMatchObject({ fields: ["whole"], actor: "moderator", removal: true })
    expect(purged).toEqual([["feed", "tributes", `place:${p.id}`]])
    expect(await op(id!)).toMatchObject({ state: "applied", intent: "written", ledger_commit: "written", purge: "done" })
  })

  it("a stale view changes nothing and stores nothing", async () => {
    const p = await published()
    expect((await runOp(opEnv, hide(p.id, p.rev - 1), now)).outcome).toBe("conflict")
    expect(await place(p.id)).toMatchObject({ status: "published", rev: p.rev })
    expect(purged).toEqual([])
  })

  it("losing a race after the intent leaves the place as the winner made it, and the operation refused", async () => {
    const p = await published()
    // Another decision lands between this one's intent and its database step.
    const spec = hide(p.id, p.rev, {
      prepare: async () => void (await env.DB.prepare("UPDATE places SET rev = rev + 1 WHERE id = ?").bind(p.id).run()),
    })
    const { outcome, id } = await runOp(opEnv, spec, now)
    expect(outcome).toBe("conflict")
    expect(await op(id!)).toMatchObject({ state: "refused", refused_reason: "conflict" })
    expect(await place(p.id)).toMatchObject({ status: "published", ledger_seq: p.ledger_seq })
    // Its intent is followed by an abort, so a replay knows it never happened.
    expect(await entryOf(ledgerKey({ place: p.id, seq_from: p.ledger_seq, op: id!, phase: "abort" }))).toMatchObject({ kind: "suppress" })
    expect(purged).toEqual([])
  })
})

describe("when the ledger refuses the intent", () => {
  it("a decision that must not go unrecorded (automatic hiding, publication) doesn't happen", async () => {
    const p = await published()
    const { outcome, id } = await runOp({ ...opEnv, ledger: refusing(() => true) }, hide(p.id, p.rev, { onIntentFailure: "refuse" }), now)
    expect(outcome).toBe("ledger_unwritten")
    expect(await op(id!)).toMatchObject({ state: "refused", refused_reason: "ledger_unwritten" })
    expect(await place(p.id)).toMatchObject({ status: "published", rev: p.rev })
    expect(purged).toEqual([])
  })

  it("a removal a person asked for goes ahead, and the missing record is repaired once the ledger is back", async () => {
    const p = await published()
    const { outcome, id } = await runOp({ ...opEnv, ledger: refusing(() => true) }, hide(p.id, p.rev), now)
    expect(outcome).toBe("ok")
    expect(await place(p.id)).toMatchObject({ status: "hidden" })
    // The cache is cleared even though nothing could be recorded.
    expect(purged).toHaveLength(1)
    expect(await op(id!)).toMatchObject({ state: "applied", intent: "failed", ledger_commit: "failed", purge: "done" })

    await resumeOps(opEnv, later(1))
    expect(await op(id!)).toMatchObject({ intent: "late", ledger_commit: "written" })
    const intent = await entryOf(ledgerKey({ place: p.id, seq_from: p.ledger_seq, op: id!, phase: "intent" }))
    expect(intent).toMatchObject({ late: true, kind: "suppress" })
    expect(purged).toHaveLength(1)
  })
})

describe("after the database has changed", () => {
  it("clears the cache even when moving the files and writing the commit both fail", async () => {
    const p = await published()
    const media = { get: async () => Promise.reject(new Error("down")) } as unknown as R2Bucket
    const spec = hide(p.id, p.rev, { detail: { fields: ["whole"], toHeld: [`public/${p.id}/x.jpg`] } })
    const { id } = await runOp({ ...opEnv, media, ledger: refusing((k) => k.endsWith("commit.json")) }, spec, now)
    expect(purged).toHaveLength(1)
    expect(await op(id!)).toMatchObject({ state: "applied", media: "failed", ledger_commit: "failed", purge: "done" })
  })

  it("a purge that keeps failing is tried three times in all, then left to the short cache lifetime", async () => {
    const p = await published()
    const failing = { ...opEnv, purge: async (tags: string[]) => (purged.push(tags), false) }
    const { id } = await runOp(failing, hide(p.id, p.rev), now)
    expect(await op(id!)).toMatchObject({ purge: "failed", purge_tries: 1 })
    await resumeOps(failing, later(1))
    await resumeOps(failing, later(2))
    expect(await op(id!)).toMatchObject({ purge: "abandoned", purge_tries: 3 })
    await resumeOps(failing, later(3))
    expect(purged).toHaveLength(3)
  })

  it("resuming finishes only the steps left, and never applies the decision twice", async () => {
    const p = await published()
    const { id } = await runOp(opEnv, hide(p.id, p.rev), now)
    // As if the Worker stopped right after the database step.
    await env.DB.prepare("UPDATE visibility_ops SET ledger_commit = 'pending', purge = 'pending' WHERE id = ?").bind(id).run()
    await env.LEDGER.delete(ledgerKey({ place: p.id, seq_from: p.ledger_seq, op: id!, phase: "commit" }))
    await resumeOps(opEnv, later(1))
    expect(await op(id!)).toMatchObject({ ledger_commit: "written", purge: "done" })
    expect(await place(p.id)).toMatchObject({ rev: p.rev + 1, ledger_seq: p.ledger_seq + 1 })
    expect(purged).toHaveLength(2)
  })
})

describe("an operation that stopped before the database step", () => {
  it("is refused as interrupted, never retried with a fresher rev over a later decision", async () => {
    const p = await published()
    // Stored and recorded as intended, then the Worker stopped.
    const crashed = hide(p.id, p.rev, { prepare: async () => Promise.reject(new Error("crash")) })
    const { id } = await runOp(opEnv, crashed, now)
    await env.DB.prepare("UPDATE visibility_ops SET state = 'pending', refused_reason = NULL WHERE id = ?").bind(id).run()
    // Meanwhile a later decision moved the place on.
    await env.DB.prepare("UPDATE places SET rev = rev + 1 WHERE id = ?").bind(p.id).run()

    await resumeOps(opEnv, later(1))
    expect(await op(id!)).toMatchObject({ state: "pending" })
    await resumeOps(opEnv, later(3))
    expect(await op(id!)).toMatchObject({ state: "refused", refused_reason: "interrupted" })
    expect(await place(p.id)).toMatchObject({ status: "published", rev: p.rev + 1 })
    expect(await entryOf(ledgerKey({ place: p.id, seq_from: p.ledger_seq, op: id!, phase: "abort" }))).toBeTruthy()
  })

  it("a copy it prepared for publication is removed again", async () => {
    const p = await published()
    const key = `public/${p.id}/prepared.jpg`
    const crashed = hide(p.id, p.rev, {
      kind: "lift",
      removal: false,
      prepare: async () => {
        throw new Error("crash")
      },
      detail: { prepared: [key] },
    })
    const { id } = await runOp(opEnv, crashed, now)
    // As if the copy was made and the Worker stopped before the database step.
    await env.MEDIA.put(key, new Uint8Array([0xff, 0xd8, 0xff]))
    await env.DB.prepare("UPDATE visibility_ops SET state = 'pending', refused_reason = NULL WHERE id = ?").bind(id).run()
    await resumeOps(opEnv, later(3))
    expect(await env.MEDIA.head(key)).toBeNull()
  })
})

describe("review findings on the engine", () => {
  it("an operation refused as interrupted gets an abort even when its intent's state was never recorded (F4-R5)", async () => {
    const p = await published()
    // The intent reached the ledger, then the Worker stopped before storing that it had.
    const { id } = await runOp(opEnv, hide(p.id, p.rev, { prepare: async () => Promise.reject(new Error("crash")) }), now)
    await env.DB.prepare("UPDATE visibility_ops SET state = 'pending', intent = 'pending', refused_reason = NULL WHERE id = ?").bind(id).run()
    await env.LEDGER.delete(ledgerKey({ place: p.id, seq_from: p.ledger_seq, op: id!, phase: "abort" }))
    await resumeOps(opEnv, later(3))
    expect(await entryOf(ledgerKey({ place: p.id, seq_from: p.ledger_seq, op: id!, phase: "abort" }))).toBeTruthy()
  })

  it("an operation refused as interrupted while its request was still running can't land afterwards (F4-R6)", async () => {
    const p = await published()
    // The request is so slow that the scheduled job gives up on it before its database step.
    const slow = hide(p.id, p.rev, { prepare: async () => void (await resumeOps(opEnv, later(3))) })
    const { outcome, id } = await runOp(opEnv, slow, now)
    expect(outcome).toBe("conflict")
    expect(await op(id!)).toMatchObject({ state: "refused", refused_reason: "interrupted" })
    expect(await place(p.id)).toMatchObject({ status: "published", rev: p.rev })
  })

  it("a decision that landed is reported as landed even if recording its last steps fails (F4-R7)", async () => {
    const p = await published()
    const db = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare")
          return (sql: string) => {
            if (sql.startsWith("UPDATE visibility_ops SET intent = ?2, media = ?3")) throw new Error("d1 down")
            return target.prepare(sql)
          }
        const value = Reflect.get(target, prop)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    expect((await runOp({ ...opEnv, db }, hide(p.id, p.rev), now)).outcome).toBe("ok")
    expect(await place(p.id)).toMatchObject({ status: "hidden" })
  })
})
