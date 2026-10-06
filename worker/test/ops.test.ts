import { env } from "cloudflare:workers"
import { beforeEach, describe, expect, it } from "vitest"
import { ledgerKey, replayDecision, type LedgerEntry } from "../lib/ledger"
import { finishOp, resumeOps, runOp, type OpEnv, type OpSpec } from "../db/ops"
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
    // The last batch stores how the finishing steps went, after the commit.
    expect(seen).toEqual([
      "put intent op-stored=true",
      "batch intent-present=true",
      "put commit op-stored=false",
      "batch intent-present=true",
    ])
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
    // The place has a published photo; the bucket refuses to read it.
    await env.DB.prepare("UPDATE revisions SET photo_key = ? WHERE id = (SELECT published_revision_id FROM places WHERE id = ?)")
      .bind(`public/${p.id}/x.jpg`, p.id)
      .run()
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
    await env.DB.prepare("UPDATE visibility_ops SET state = 'pending', intent = 'pending', refused_reason = NULL WHERE id = ?")
      .bind(id)
      .run()
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
            if (sql.includes("purge_tries = purge_tries + 1")) throw new Error("d1 down")
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

describe("a refused operation's abort is never lost (F4-O1)", () => {
  /** A removal that loses its race after its intent is written: refused, so it needs an abort. */
  const losing = (placeId: string, rev: number) =>
    hide(placeId, rev, {
      statements: (tid) => [env.DB.prepare("UPDATE places SET last_transition_id = ?2 WHERE id = ?1 AND 0").bind(placeId, tid)],
    })
  const abortKey = (placeId: string, seq: number, id: string) => ledgerKey({ place: placeId, seq_from: seq, op: id, phase: "abort" })
  const replayed = async (placeId: string, from: number) => {
    const { objects } = await env.LEDGER.list({ prefix: `ledger/${placeId}/` })
    const entries = await Promise.all(objects.map(async (o) => (await env.LEDGER.get(o.key))!.json<LedgerEntry>()))
    return replayDecision(entries, from).apply.map((e) => e.op)
  }

  it("an abort the ledger refused is written by the next scheduled run, and the refused removal stops replaying", async () => {
    const p = await published()
    const down = { ...opEnv, ledger: refusing((key) => key.endsWith("-abort.json")) }
    const { outcome, id } = await runOp(down, losing(p.id, p.rev), now)
    expect(outcome).toBe("conflict")
    expect(await op(id!)).toMatchObject({ state: "refused", abort: "failed" })
    // Until it is repaired, the record reads as a removal that may have happened.
    expect(await replayed(p.id, p.ledger_seq)).toContain(id)

    await resumeOps(opEnv, later(1))
    expect(await op(id!)).toMatchObject({ state: "refused", abort: "written" })
    expect(await entryOf(abortKey(p.id, p.ledger_seq, id!))).toMatchObject({ phase: "abort", late: true })
    expect(await replayed(p.id, p.ledger_seq)).not.toContain(id)
  })

  it("a refusal recorded just before the Worker stopped, with no abort yet, gets its abort from the scheduled run", async () => {
    const p = await published()
    const { id } = await runOp(opEnv, losing(p.id, p.rev), now)
    // As if the Worker stopped between storing the refusal and writing the abort.
    await env.DB.prepare("UPDATE visibility_ops SET abort = 'pending' WHERE id = ?").bind(id).run()
    await env.LEDGER.delete(abortKey(p.id, p.ledger_seq, id!))
    await resumeOps(opEnv, later(1))
    expect(await op(id!)).toMatchObject({ abort: "written" })
    expect(await entryOf(abortKey(p.id, p.ledger_seq, id!))).toBeTruthy()
  })
})

describe("finishing an operation is safe to run twice at once, and fair to every operation (F4-O3)", () => {
  /** A database whose reads of `sql` fail. */
  const failing = (match: string) =>
    new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare")
          return (sql: string) => {
            if (sql.startsWith(match)) throw new Error("d1 down")
            return target.prepare(sql)
          }
        const value = Reflect.get(target, prop)
        return typeof value === "function" ? value.bind(target) : value
      },
    })

  it("a slower finisher that failed can't undo what a faster one completed", async () => {
    const p = await published()
    const { id } = await runOp(opEnv, hide(p.id, p.rev), now)
    await env.DB.prepare(
      "UPDATE visibility_ops SET detail = ?2, media = 'pending', ledger_commit = 'pending', purge = 'pending', purge_tries = 0 WHERE id = ?1",
    )
      .bind(id, JSON.stringify({ fields: ["whole"], toHeld: [`public/${p.id}/x.jpg`] }))
      .run()
    // The slow one: its file step fails, then it waits at the ledger, and its commit and purge fail too.
    let open!: () => void
    const gate = new Promise<void>((r) => (open = r))
    let waited = 0
    const slowLedger = new Proxy(env.LEDGER, {
      get(target, prop) {
        if (prop === "put") return async () => (waited++, await gate, Promise.reject(new Error("down")))
        const value = Reflect.get(target, prop)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    const slow = finishOp(
      { db: failing("SELECT p.status, r.photo_key"), media: env.MEDIA, ledger: slowLedger, purge: async () => false },
      id!,
      later(1),
    )
    await finishOp(opEnv, id!, later(1))
    expect(await op(id!)).toMatchObject({ media: "done", ledger_commit: "written", purge: "done" })
    open()
    await slow
    expect(waited).toBe(1)
    expect(await op(id!)).toMatchObject({ media: "done", ledger_commit: "written", purge: "done" })
  })

  it("two finishers whose purges both fail count two tries, not one", async () => {
    const p = await published()
    const { id } = await runOp(opEnv, hide(p.id, p.rev), now)
    await env.DB.prepare("UPDATE visibility_ops SET purge = 'pending', purge_tries = 0 WHERE id = ?").bind(id).run()
    // Both finishers read the operation, then both purges fail together.
    let arrived = 0
    let open!: () => void
    const gate = new Promise<void>((r) => (open = r))
    const purge = async () => {
      if (++arrived === 2) open()
      await gate
      return false
    }
    await Promise.all([finishOp({ ...opEnv, purge }, id!, later(1)), finishOp({ ...opEnv, purge }, id!, later(1))])
    expect(arrived).toBe(2)
    expect(await op(id!)).toMatchObject({ purge: "failed", purge_tries: 2 })
  })

  it("operations that keep failing don't hold back the ones behind them, and one that throws doesn't stop the run", async () => {
    const p = await published()
    const old = "2026-10-06T07:00:00.000Z"
    const row = (id: string, detail = '{"fields":["whole"]}') =>
      env.DB.prepare(
        `INSERT INTO visibility_ops (id, place_id, kind, actor, removal, expected_rev, seq_from, detail, state, intent, media,
           ledger_commit, purge, created_at, updated_at)
         VALUES (?1, ?2, 'suppress', 'moderator', 1, 1, 0, ?3, 'applied', 'written', 'none', 'failed', 'none', ?4, ?4)`,
      ).bind(id, p.id, detail, old)
    const stuck = Array.from({ length: 100 }, (_, i) => `t_starve_${String(i).padStart(3, "0")}`)
    await env.DB.batch([...stuck.map((id) => row(id)), row("t_starve_100_poison", "not json"), row("t_starve_101")])
    // The ledger keeps refusing the first hundred's commits, as long as the test runs.
    const ledger = refusing((key) => stuck.some((id) => key.includes(id)))
    await resumeOps({ ...opEnv, ledger }, later(1))
    expect(await op("t_starve_101")).toMatchObject({ ledger_commit: "failed" })
    await resumeOps({ ...opEnv, ledger }, later(2))
    expect(await op("t_starve_101")).toMatchObject({ ledger_commit: "written" })
    expect(await op("t_starve_000")).toMatchObject({ ledger_commit: "failed" })
  })
})

describe("purge retries are reserved before they are tried (F4-O3)", () => {
  /** An applied operation whose purge has been tried `tries` times and failed. */
  async function failedPurge(tries: number) {
    const p = await published()
    const { id } = await runOp(opEnv, hide(p.id, p.rev), now)
    await env.DB.prepare("UPDATE visibility_ops SET purge = 'failed', purge_tries = ? WHERE id = ?").bind(tries, id).run()
    return id!
  }
  /** A purge whose answer waits until the test gives it. */
  function heldPurge() {
    const answers: ((ok: boolean) => void)[] = []
    let calls = 0
    const purge = () => (calls++, new Promise<boolean>((r) => answers.push(r)))
    return { purge, answers, calls: () => calls }
  }
  const settle = () => new Promise((r) => setTimeout(r, 20))

  it("at the last try, two finishers at once make one purge call between them", async () => {
    const id = await failedPurge(2)
    let calls = 0
    const purge = async () => (calls++, false)
    await Promise.all([finishOp({ ...opEnv, purge }, id, later(1)), finishOp({ ...opEnv, purge }, id, later(1))])
    expect(calls).toBe(1)
    expect(await op(id)).toMatchObject({ purge: "abandoned", purge_tries: 3 })
  })

  it("a success that arrives after the last failure gave up still counts: the cache was cleared", async () => {
    const id = await failedPurge(1)
    const held = heldPurge()
    const a = finishOp({ ...opEnv, purge: held.purge }, id, later(1))
    const b = finishOp({ ...opEnv, purge: held.purge }, id, later(1))
    while (held.calls() < 2) await settle()
    held.answers[0](false)
    await a
    expect(await op(id)).toMatchObject({ purge: "abandoned", purge_tries: 3 })
    held.answers[1](true)
    await b
    expect(await op(id)).toMatchObject({ purge: "done", purge_tries: 3 })
  })

  it("a failure that arrives after a success can't undo it", async () => {
    const id = await failedPurge(1)
    const held = heldPurge()
    const a = finishOp({ ...opEnv, purge: held.purge }, id, later(1))
    const b = finishOp({ ...opEnv, purge: held.purge }, id, later(1))
    while (held.calls() < 2) await settle()
    held.answers[0](true)
    await a
    held.answers[1](false)
    await b
    expect(await op(id)).toMatchObject({ purge: "done" })
  })

  it("a reserved try whose finisher stopped before its answer counts as failed: with no tries left the purge is given up, not retried", async () => {
    const id = await failedPurge(3)
    const placeId = (await op(id))!.place_id
    let calls = 0
    // Other tests' operations may be retried too: only this place's purges are counted.
    const purge = async (tags: string[]) => (tags.includes(`place:${placeId}`) && calls++, true)
    await resumeOps({ ...opEnv, purge }, later(1))
    expect(calls).toBe(0)
    expect(await op(id)).toMatchObject({ purge: "abandoned", purge_tries: 3 })
  })
})

describe("refused cleanups that keep failing don't hold back the rest (F4-O3)", () => {
  it("more than a hundred of them, abort already written: a later operation is still finished", async () => {
    const p = await published()
    const old = "2026-10-06T06:00:00.000Z"
    const refusedRow = (id: string) =>
      env.DB.prepare(
        `INSERT INTO visibility_ops (id, place_id, kind, actor, removal, expected_rev, seq_from, detail, state, refused_reason,
           intent, media, ledger_commit, purge, abort, created_at, updated_at)
         VALUES (?1, ?2, 'approve', 'moderator', 0, 1, 0, ?3, 'refused', 'conflict', 'written', 'failed', 'pending', 'none',
           'written', ?4, ?4)`,
      ).bind(id, p.id, JSON.stringify({ prepared: [`public/${p.id}/${id}.jpg`] }), old)
    const stuck = Array.from({ length: 101 }, (_, i) => `t_clean_${String(i).padStart(3, "0")}`)
    await env.DB.batch([
      ...stuck.map(refusedRow),
      env.DB.prepare(
        `INSERT INTO visibility_ops (id, place_id, kind, actor, removal, expected_rev, seq_from, detail, state, intent, media,
           ledger_commit, purge, created_at, updated_at)
         VALUES ('t_clean_later', ?1, 'suppress', 'moderator', 1, 1, 0, '{"fields":["whole"]}', 'applied', 'written', 'none',
           'failed', 'none', ?2, ?2)`,
      ).bind(p.id, "2026-10-06T06:30:00.000Z"),
    ])
    // The bucket keeps refusing to delete their prepared copies.
    const media = new Proxy(env.MEDIA, {
      get(target, prop) {
        if (prop === "delete")
          return async (keys: string | string[]) =>
            [keys].flat().some((k) => k.includes("t_clean_")) ? Promise.reject(new Error("down")) : target.delete(keys)
        const value = Reflect.get(target, prop)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    await resumeOps({ ...opEnv, media }, later(1))
    await resumeOps({ ...opEnv, media }, later(2))
    expect(await op("t_clean_later")).toMatchObject({ ledger_commit: "written" })
    expect(await op("t_clean_000")).toMatchObject({ media: "failed" })
  })
})

describe("a refusal and a preparation racing each other leave the cleanup owed (F4-B)", () => {
  /** A door the test opens. */
  function gate() {
    let open!: () => void
    let arrived!: () => void
    const opened = new Promise<void>((r) => (open = r))
    const arrival = new Promise<void>((r) => (arrived = r))
    return { open, arrival, wait: async () => (arrived(), await opened) }
  }
  /** The job's database, pausing after it has read the operations it will work on. */
  function pausingAfterRead(door: ReturnType<typeof gate>) {
    return new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare")
          return (sql: string) => {
            const stmt = target.prepare(sql)
            if (!sql.includes("ORDER BY updated_at, id LIMIT")) return stmt
            return {
              bind: (...args: unknown[]) => {
                const bound = stmt.bind(...args)
                return {
                  // The rows as read before the pause: the job works on this snapshot.
                  all: async () => {
                    const read = await bound.all()
                    await door.wait()
                    return read
                  },
                }
              },
            }
          }
        const value = Reflect.get(target, prop)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
  }
  /** A bucket that refuses to delete `key` the first time it is asked. */
  function failingOnce(key: string) {
    let failed = false
    return new Proxy(env.MEDIA, {
      get(target, prop) {
        if (prop === "delete")
          return async (keys: string | string[]) => {
            if (!failed && [keys].flat().includes(key)) {
              failed = true
              throw new Error("down")
            }
            return target.delete(keys)
          }
        const value = Reflect.get(target, prop)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
  }
  /** A decision that prepares a copy of its own, nothing names, when the test lets it. */
  const preparing = (placeId: string, rev: number, key: string, door: ReturnType<typeof gate>) =>
    hide(placeId, rev, {
      kind: "approve",
      removal: false,
      onIntentFailure: "refuse",
      prepare: async () => {
        await door.wait()
        await env.MEDIA.put(key, new Uint8Array([0xff, 0xd8, 0xff]))
        return { prepared: [key] }
      },
    })
  const stoppedBeforeCas = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "batch") return async () => Promise.reject(new Error("worker stopped"))
      const value = Reflect.get(target, prop)
      return typeof value === "function" ? value.bind(target) : value
    },
  })

  it("the job read the operation before its copy was recorded, and refuses it after: the copy is still cleaned up, on a later run if the first try fails", async () => {
    const p = await published()
    const key = `public/${p.id}/prepared-stale.jpg`
    const preparer = gate()
    const reader = gate()
    // The request stops before its database step, once its copy is recorded.
    const request = runOp({ ...opEnv, db: stoppedBeforeCas }, preparing(p.id, p.rev, key, preparer), now).catch((e: Error) => e)
    await preparer.arrival
    const job = resumeOps({ ...opEnv, db: pausingAfterRead(reader), media: failingOnce(key) }, later(3))
    await reader.arrival
    preparer.open()
    expect(String(await request)).toContain("worker stopped")
    const [stored] = (
      await env.DB.prepare("SELECT id, detail FROM visibility_ops WHERE place_id = ?").bind(p.id).all<{ id: string; detail: string }>()
    ).results.filter((r) => r.detail.includes(key))
    reader.open()
    await job
    expect(await op(stored.id)).toMatchObject({ state: "refused", refused_reason: "interrupted", media: "failed" })
    expect(await env.MEDIA.head(key)).not.toBeNull()
    await resumeOps(opEnv, later(4))
    expect(await op(stored.id)).toMatchObject({ media: "done" })
    expect(await env.MEDIA.head(key)).toBeNull()
  })

  it("the reverse: refused as interrupted before its copy was recorded, the request records it after: the cleanup is owed, and done", async () => {
    const p = await published()
    const key = `public/${p.id}/prepared-late.jpg`
    const preparer = gate()
    const request = runOp({ ...opEnv, media: failingOnce(key) }, preparing(p.id, p.rev, key, preparer), now)
    await preparer.arrival
    await resumeOps(opEnv, later(3))
    preparer.open()
    const { outcome, id } = await request
    expect(outcome).toBe("conflict")
    expect(await op(id!)).toMatchObject({ state: "refused", media: "failed" })
    expect(await env.MEDIA.head(key)).not.toBeNull()
    await resumeOps(opEnv, later(4))
    expect(await op(id!)).toMatchObject({ media: "done" })
    expect(await env.MEDIA.head(key)).toBeNull()
    expect(await place(p.id)).toMatchObject({ status: "published", rev: p.rev })
  })
})
