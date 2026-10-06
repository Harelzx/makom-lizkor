import { ulid } from "../lib/ids"
import { writeLedger, type Actor, type LedgerEntry, type OpKind } from "../lib/ledger"
import { retirePhotos } from "./places"

/** What an operation reaches: the database, the files, the ledger and the edge cache. */
export type OpEnv = { db: D1Database; media: R2Bucket; ledger: R2Bucket; purge: (tags: string[]) => Promise<boolean> }

/** Ids and codes only, like the ledger they feed: field names, file keys, a basis code, a report's id. */
export type OpDetail = {
  fields?: string[]
  /** The suppression rows the decision creates or lifts, for the ledger. */
  targets?: string[]
  /** The files the decision concerns, for the ledger. */
  media?: string[]
  basis?: string
  report?: string
  /** After the database step: public files to take out of view (their held/ copy stays, so nothing is lost). */
  toHeld?: string[]
  /** After the database step: held photos a restoration serves again. */
  dropHeld?: string[]
  /** After the database step: files the decision made obsolete, removed if nothing live names them. */
  retire?: string[]
  /** Before the database step: copies made so the decision can publish them; removed again if it never lands. */
  prepared?: string[]
}

export type OpSpec = {
  placeId: string
  kind: OpKind
  actor: Actor
  expectedRev: number
  /** Takes something out of public view (spec 8.2: replayed even without its commit). */
  removal: boolean
  /** Changes what the public sees, so the edge cache is purged once it has happened. */
  public: boolean
  /**
   * When the ledger refuses the intent: "refuse" for what must never happen unrecorded (an automatic hide, a
   * publication, a restoration); "proceed" for a removal a person asked for, which goes ahead and is repaired later.
   */
  onIntentFailure: "refuse" | "proceed"
  detail?: OpDetail
  /** Before the database step, after the intent: e.g. an approval's photo copy. Its additions join the stored detail. */
  prepare?: () => Promise<OpDetail | void>
  /** The decision itself. The first statement is the compare-and-set on the place: it sets `last_transition_id` to
   * `tid` and moves `rev` on, and every other statement is conditioned on that having happened. */
  statements: (tid: string) => D1PreparedStatement[]
}

export type OpOutcome = "ok" | "conflict" | "ledger_unwritten" | "prepare_failed"

type OpRow = {
  id: string
  place_id: string
  kind: OpKind
  actor: Actor
  removal: number
  expected_rev: number
  seq_from: number
  rev_to: number | null
  result_status: string | null
  detail: string
  state: "pending" | "applied" | "refused"
  intent: "pending" | "written" | "failed" | "late"
  media: "none" | "pending" | "done" | "failed"
  ledger_commit: "pending" | "written" | "failed"
  purge: "none" | "pending" | "done" | "failed" | "abandoned"
  purge_tries: number
  abort: "none" | "pending" | "written" | "failed"
  created_at: string
  updated_at: string
}

/** A purge is tried this many times in all; after that the edge copy's short lifetime is the bound (spec 5). */
const PURGE_TRIES = 3
/** An operation still pending after this long stopped before its database step: no live request is behind it. */
const INTERRUPTED_MS = 2 * 60_000
/** Operations one scheduled run takes on; the least recently tried first, so none waits behind ones that keep failing. */
const RESUME_BATCH = 100
/** Passes placePhoto makes before leaving the photo to the next run: each one re-reads the state after its own writes. */
const PLACE_PASSES = 4

const tagsFor = (placeId: string) => ["feed", "tributes", `place:${placeId}`]
const heldKey = (key: string) => key.replace(/^public\//, "held/")

function entry(op: OpRow, phase: LedgerEntry["phase"], at: string, late = false): LedgerEntry {
  const detail = JSON.parse(op.detail) as OpDetail
  const media = [...new Set([...(detail.media ?? []), ...(detail.toHeld ?? []), ...(detail.prepared ?? [])])]
  return {
    op: op.id,
    place: op.place_id,
    phase,
    kind: op.kind,
    actor: op.actor,
    seq_from: op.seq_from,
    seq_to: op.seq_from + 1,
    rev_from: op.expected_rev,
    rev_to: phase === "commit" && op.rev_to !== null ? op.rev_to : op.expected_rev + 1,
    removal: !!op.removal,
    ...(phase === "commit" && op.result_status ? { status: op.result_status } : {}),
    ...(detail.fields?.length ? { fields: detail.fields } : {}),
    ...(detail.targets?.length ? { targets: detail.targets } : {}),
    ...(media.length ? { media } : {}),
    ...(detail.basis ? { basis: detail.basis } : {}),
    at,
    ...(late ? { late: true } : {}),
  }
}

const readOp = (db: D1Database, id: string) => db.prepare("SELECT * FROM visibility_ops WHERE id = ?").bind(id).first<OpRow>()

/**
 * One recorded decision, in the order spec 8.2 and the adviser's review set: stored with the rev it expects before any
 * side effect; the intent in the ledger; anything that must exist before the decision (a copy to publish); the
 * database step, with the place's chain, the feed and the operation's own outcome in one batch; then, as separate steps
 * that are each retried on their own, the files, the commit and the purge. Once the database has changed, the purge is
 * tried whatever happened to the files or the ledger.
 */
export async function runOp(env: OpEnv, spec: OpSpec, now: Date): Promise<{ outcome: OpOutcome; id?: string }> {
  const current = await env.db
    .prepare("SELECT rev, ledger_seq FROM places WHERE id = ?")
    .bind(spec.placeId)
    .first<{ rev: number; ledger_seq: number }>()
  // A view that is already stale decides nothing, and leaves nothing behind.
  if (!current || current.rev !== spec.expectedRev) return { outcome: "conflict" }
  const id = `t_${ulid(now.getTime())}`
  const at = now.toISOString()
  let detail: OpDetail = spec.detail ?? {}
  const afterMedia = () => (detail.toHeld?.length || detail.dropHeld?.length || detail.retire?.length ? "pending" : "none")
  await env.db
    .prepare(
      `INSERT INTO visibility_ops (id, place_id, kind, actor, removal, expected_rev, seq_from, detail, state, intent, media, ledger_commit,
         purge, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', 'pending', ?9, 'pending', ?10, ?11, ?11)`,
    )
    .bind(
      id,
      spec.placeId,
      spec.kind,
      spec.actor,
      spec.removal ? 1 : 0,
      spec.expectedRev,
      current.ledger_seq,
      JSON.stringify(detail),
      afterMedia(),
      spec.public ? "pending" : "none",
      at,
    )
    .run()
  const refuse = async (reason: string) => {
    // The abort is owed from the moment of refusal: stored with it, so a Worker that stops here leaves it to the job.
    await env.db
      .prepare(
        "UPDATE visibility_ops SET state = 'refused', refused_reason = ?2, abort = 'pending', updated_at = ?3 WHERE id = ?1 AND state = 'pending'",
      )
      .bind(id, reason, at)
      .run()
    await abortRecorded(env, id, at)
    await cleanPrepared(env, spec.placeId, detail)
  }

  const stored = (await readOp(env.db, id))!
  const intentWritten = await writeLedger(env.ledger, entry(stored, "intent", at))
  await env.db
    .prepare("UPDATE visibility_ops SET intent = ?2 WHERE id = ?1")
    .bind(id, intentWritten ? "written" : "failed")
    .run()
  if (!intentWritten && spec.onIntentFailure === "refuse") {
    await refuse("ledger_unwritten")
    return { outcome: "ledger_unwritten", id }
  }

  if (spec.prepare) {
    try {
      detail = { ...detail, ...((await spec.prepare()) ?? {}) }
    } catch {
      await refuse("prepare_failed")
      return { outcome: "prepare_failed", id }
    }
    // What was prepared is stored before the database step, so an interruption can still clean it up.
    await env.db
      .prepare("UPDATE visibility_ops SET detail = ?2, media = ?3 WHERE id = ?1")
      .bind(id, JSON.stringify(detail), afterMedia())
      .run()
  }

  const happened = "EXISTS (SELECT 1 FROM places WHERE id = ?1 AND last_transition_id = ?2)"
  let cas: D1Result
  try {
    ;[cas] = await env.db.batch([
      ...spec.statements(id),
      env.db.prepare(`UPDATE places SET ledger_seq = ledger_seq + 1 WHERE id = ?1 AND last_transition_id = ?2`).bind(spec.placeId, id),
      env.db
        .prepare(
          `UPDATE visibility_ops SET state = 'applied', rev_to = (SELECT rev FROM places WHERE id = ?1),
           result_status = (SELECT status FROM places WHERE id = ?1), updated_at = ?3
         WHERE id = ?2 AND ${happened}`,
        )
        .bind(spec.placeId, id, at),
    ])
  } catch (err) {
    // Refused as interrupted while this request was still on its way (migrations/0010): nothing landed.
    if (!String((err as Error).message).includes("operation_not_pending")) throw err
    await refuse("conflict")
    return { outcome: "conflict", id }
  }
  if (cas.meta.changes !== 1) {
    await refuse("conflict")
    return { outcome: "conflict", id }
  }
  // The decision has landed: a failure in the steps after it is the scheduled job's to finish, never the request's.
  await finishOp(env, id, now).catch((err: Error) =>
    console.error(JSON.stringify({ level: "error", event: "op_finish_failed", op: id, error: err.name })),
  )
  return { outcome: "ok", id }
}

/**
 * The steps after the database step, each on its own, so one that fails never holds back the others. Two finishers
 * may run at once (a slow request and the scheduled job): each step's result is stored only if it moves the step
 * forward, never back, and every purge attempt is counted.
 */
export async function finishOp(env: OpEnv, id: string, now: Date) {
  const op = await readOp(env.db, id)
  if (!op || op.state !== "applied") return
  const at = now.toISOString()
  // Tried now, whatever comes of it: the job takes the least recently tried first.
  await env.db.prepare("UPDATE visibility_ops SET updated_at = ?2 WHERE id = ?1").bind(id, at).run()
  const detail = JSON.parse(op.detail) as OpDetail
  const steps: D1PreparedStatement[] = []

  // An intent the ledger refused at the time: written now, marked late, before its commit.
  if (op.intent === "failed" && (await writeLedger(env.ledger, entry(op, "intent", at, true))))
    steps.push(env.db.prepare("UPDATE visibility_ops SET intent = 'late' WHERE id = ?1 AND intent = 'failed'").bind(id))
  if (op.media === "pending" || op.media === "failed") {
    let ok = true
    try {
      // Where the published photo belongs is read from the place as it is now, not replayed from this decision: a
      // later hide or restoration may already own the file, and must not be undone by finishing an older one.
      if (detail.toHeld?.length || detail.dropHeld?.length) await placePhoto(env, op.place_id)
      if (detail.retire?.length) await retirePhotos(env.db, env.media, detail.retire)
    } catch {
      ok = false
    }
    steps.push(
      ok
        ? env.db.prepare("UPDATE visibility_ops SET media = 'done' WHERE id = ?1 AND media IN ('pending', 'failed')").bind(id)
        : env.db.prepare("UPDATE visibility_ops SET media = 'failed' WHERE id = ?1 AND media = 'pending'").bind(id),
    )
  }
  if (op.ledger_commit !== "written") {
    const written = await writeLedger(env.ledger, entry(op, "commit", at))
    steps.push(
      env.db
        .prepare("UPDATE visibility_ops SET ledger_commit = ?2 WHERE id = ?1 AND ledger_commit != 'written'")
        .bind(id, written ? "written" : "failed"),
    )
  }
  if (op.purge === "pending" || op.purge === "failed") {
    const ok = await env.purge(tagsFor(op.place_id)).catch(() => false)
    // Counted in the database, not from this finisher's copy, so two finishers' failed tries both count.
    steps.push(
      env.db
        .prepare(
          `UPDATE visibility_ops SET purge_tries = purge_tries + 1,
             purge = CASE WHEN ?2 = 1 THEN 'done' WHEN purge_tries + 1 >= ?3 THEN 'abandoned' ELSE 'failed' END
           WHERE id = ?1 AND purge IN ('pending', 'failed')`,
        )
        .bind(id, ok ? 1 : 0, PURGE_TRIES),
    )
  }
  if (steps.length) await env.db.batch(steps)
}

/**
 * The scheduled job's pass over operations left unfinished. One that reached the database has its remaining steps
 * finished. One that never did, and has had time to, is refused as interrupted: it is never retried with a newer rev,
 * which could undo a later decision, and anything it prepared to publish is removed again. Its decision is the
 * moderator's to make again (removals that stopped show in the admin as interrupted).
 */
export async function resumeOps(env: OpEnv, now: Date) {
  const at = now.toISOString()
  const { results } = await env.db
    .prepare(
      `SELECT * FROM visibility_ops
       WHERE (state = 'applied' AND (intent = 'failed' OR media IN ('pending', 'failed') OR ledger_commit != 'written'
                                     OR purge IN ('pending', 'failed')))
          OR (state = 'pending' AND created_at <= ?1)
          OR (state = 'refused' AND abort IN ('pending', 'failed'))
       ORDER BY updated_at, id LIMIT ?2`,
    )
    .bind(new Date(now.getTime() - INTERRUPTED_MS).toISOString(), RESUME_BATCH)
    .all<OpRow>()
  for (const op of results) {
    // One operation's failure is its own: it is tried again on a later run, and the rest go on now.
    try {
      if (op.state === "applied") await finishOp(env, op.id, now)
      else if (op.state === "refused") await abortRecorded(env, op.id, at, true)
      else {
        const refused = await env.db
          .prepare(
            `UPDATE visibility_ops SET state = 'refused', refused_reason = 'interrupted', abort = 'pending', updated_at = ?2
             WHERE id = ?1 AND state = 'pending'`,
          )
          .bind(op.id, at)
          .run()
        if (refused.meta.changes === 1) {
          await abortRecorded(env, op.id, at)
          await cleanPrepared(env, op.place_id, JSON.parse(op.detail) as OpDetail)
        }
      }
    } catch (err) {
      console.error(JSON.stringify({ level: "error", event: "op_resume_failed", op: op.id, error: (err as Error).name }))
      await env.db
        .prepare("UPDATE visibility_ops SET updated_at = ?2 WHERE id = ?1")
        .bind(op.id, at)
        .run()
        .catch(() => undefined)
    }
  }
}

/**
 * A refused operation gets an abort in the ledger, so a replay knows it never happened. Written whatever the stored
 * intent state says: the intent may have reached the ledger just before a crash recorded it, and an abort with no
 * intent beside it is harmless. One the ledger refused stays owed, and the job writes it, marked late.
 */
async function abortRecorded(env: OpEnv, id: string, at: string, late = false) {
  const op = await readOp(env.db, id)
  if (!op) return
  const written = await writeLedger(env.ledger, entry(op, "abort", at, late))
  await env.db
    .prepare("UPDATE visibility_ops SET abort = ?2, updated_at = ?3 WHERE id = ?1 AND abort IN ('pending', 'failed')")
    .bind(id, written ? "written" : "failed", at)
    .run()
}

/**
 * Copies made for a decision that never landed. A copy nothing names (an approval's own key) is removed; one the
 * published revision names (a restoration's) is put where the place's state says it belongs: an identical restoration
 * may have won meanwhile, and its photo must stay.
 */
async function cleanPrepared(env: OpEnv, placeId: string, detail: OpDetail) {
  if (!detail.prepared?.length) return
  try {
    await retirePhotos(env.db, env.media, detail.prepared)
    await placePhoto(env, placeId)
  } catch {
    // Left for the sweep: nothing serves a file the database doesn't make public.
  }
}

/**
 * Puts the published photo of a place where its state says it belongs: served from public/ when the place is
 * published and no photo or whole-place hide is active, out of public/ otherwise. held/ keeps a copy for as long as
 * the photo is published, and nothing here ever deletes it, so however decisions overlap there is always a copy to
 * restore from (only retiring or erasing the photo removes it).
 *
 * Several of these can run at once for one place (a slow request and the job, two decisions in a row), and a delete
 * already on its way can't be called back. So each pass re-reads the state after its own writes, and the call ends
 * only when a pass finds the files already where the state says: a finisher whose delete lands late sees the result on
 * its next pass and puts the copy back. A photo that still hasn't settled after a few passes throws, so its
 * operation's file step stays unfinished and the job runs it again.
 */
export async function placePhoto(env: OpEnv, placeId: string) {
  for (let pass = 0; pass < PLACE_PASSES; pass++) {
    const row = await env.db
      .prepare(
        `SELECT p.status, r.photo_key,
           EXISTS (SELECT 1 FROM field_suppressions s WHERE s.place_id = p.id AND s.lifted_at IS NULL AND s.field IN ('photo', 'whole')) AS hidden
         FROM places p LEFT JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?`,
      )
      .bind(placeId)
      .first<{ status: string; photo_key: string | null; hidden: number }>()
    const key = row?.photo_key
    if (!row || !key?.startsWith("public/")) return
    const served = row.status === "published" && !row.hidden
    const held = heldKey(key)
    let changed = false
    // The kept copy first, from the served one, before anything can take the served one away.
    if (!(await env.media.head(held))) changed = (await copy(env.media, key, held)) || changed
    if (served) {
      if (!(await env.media.head(key))) changed = (await copy(env.media, held, key)) || changed
    } else if (await env.media.head(key)) {
      // Only once the kept copy is there: a photo is never left with no copy at all.
      if (!(await env.media.head(held))) throw new Error("photo_unsettled")
      await env.media.delete(key)
      changed = true
    }
    if (!changed) return
  }
  throw new Error("photo_unsettled")
}

/** Copies a file if it is there; false when there was nothing to copy. */
async function copy(media: R2Bucket, from: string, to: string) {
  const object = await media.get(from)
  if (!object) return false
  await media.put(to, await object.arrayBuffer(), { httpMetadata: object.httpMetadata })
  return true
}
