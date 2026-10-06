import { ulid } from "../lib/ids"
import { writeLedger, type Actor, type LedgerEntry, type OpKind } from "../lib/ledger"
import { retirePhotos } from "./places"

/** What an operation reaches: the database, the files, the ledger and the edge cache. */
export type OpEnv = { db: D1Database; media: R2Bucket; ledger: R2Bucket; purge: (tags: string[]) => Promise<boolean> }

/** Ids and codes only, like the ledger they feed: field names, file keys, a basis code, a report's id. */
export type OpDetail = {
  fields?: string[]
  /** The files the decision concerns, for the ledger. */
  media?: string[]
  basis?: string
  report?: string
  /** After the database step: public files to move to held/ (a hidden photo stays stored, not served). */
  toHeld?: string[]
  /** After the database step: held copies a restoration made public again. */
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
  created_at: string
}

/** A purge is tried this many times in all; after that the edge copy's short lifetime is the bound (spec 5). */
const PURGE_TRIES = 3
/** An operation still pending after this long stopped before its database step: no live request is behind it. */
const INTERRUPTED_MS = 2 * 60_000

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
    await env.db
      .prepare("UPDATE visibility_ops SET state = 'refused', refused_reason = ?2, updated_at = ?3 WHERE id = ?1 AND state = 'pending'")
      .bind(id, reason, at)
      .run()
    await abortRecorded(env, id, at)
    await cleanPrepared(env, spec.kind, detail)
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
  const [cas] = await env.db.batch([
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
  if (cas.meta.changes !== 1) {
    await refuse("conflict")
    return { outcome: "conflict", id }
  }
  await finishOp(env, id, now)
  return { outcome: "ok", id }
}

/** The steps after the database step, each on its own, so one that fails never holds back the others. */
export async function finishOp(env: OpEnv, id: string, now: Date) {
  const op = await readOp(env.db, id)
  if (!op || op.state !== "applied") return
  const at = now.toISOString()
  const detail = JSON.parse(op.detail) as OpDetail
  let { intent, media, ledger_commit, purge, purge_tries } = op

  // An intent the ledger refused at the time: written now, marked late, before its commit.
  if (intent === "failed" && (await writeLedger(env.ledger, entry(op, "intent", at, true)))) intent = "late"
  if (media === "pending" || media === "failed") {
    try {
      for (const key of detail.toHeld ?? []) await move(env.media, key, heldKey(key))
      if (detail.dropHeld?.length) await env.media.delete(detail.dropHeld)
      if (detail.retire?.length) await retirePhotos(env.db, env.media, detail.retire)
      media = "done"
    } catch {
      media = "failed"
    }
  }
  if (ledger_commit !== "written") ledger_commit = (await writeLedger(env.ledger, entry(op, "commit", at))) ? "written" : "failed"
  if (purge === "pending" || purge === "failed") {
    const ok = await env.purge(tagsFor(op.place_id)).catch(() => false)
    purge_tries += 1
    purge = ok ? "done" : purge_tries >= PURGE_TRIES ? "abandoned" : "failed"
  }
  await env.db
    .prepare(
      "UPDATE visibility_ops SET intent = ?2, media = ?3, ledger_commit = ?4, purge = ?5, purge_tries = ?6, updated_at = ?7 WHERE id = ?1",
    )
    .bind(id, intent, media, ledger_commit, purge, purge_tries, at)
    .run()
}

/**
 * The scheduled job's pass over operations left unfinished. One that reached the database has its remaining steps
 * finished. One that never did, and has had time to, is refused as interrupted: it is never retried with a newer rev,
 * which could undo a later decision, and anything it prepared to publish is removed again. Its decision is the
 * moderator's to make again (removals that stopped show in the admin as interrupted).
 */
export async function resumeOps(env: OpEnv, now: Date) {
  const { results } = await env.db
    .prepare(
      `SELECT * FROM visibility_ops
       WHERE (state = 'applied' AND (intent = 'failed' OR media IN ('pending', 'failed') OR ledger_commit != 'written'
                                     OR purge IN ('pending', 'failed')))
          OR (state = 'pending' AND created_at <= ?1)
       ORDER BY created_at LIMIT 100`,
    )
    .bind(new Date(now.getTime() - INTERRUPTED_MS).toISOString())
    .all<OpRow>()
  for (const op of results) {
    if (op.state === "applied") {
      await finishOp(env, op.id, now)
      continue
    }
    const refused = await env.db
      .prepare(
        "UPDATE visibility_ops SET state = 'refused', refused_reason = 'interrupted', updated_at = ?2 WHERE id = ?1 AND state = 'pending'",
      )
      .bind(op.id, now.toISOString())
      .run()
    if (refused.meta.changes === 1) {
      await abortRecorded(env, op.id, now.toISOString())
      await cleanPrepared(env, op.kind, JSON.parse(op.detail) as OpDetail)
    }
  }
}

/** A refused operation whose intent reached the ledger gets an abort beside it, so a replay knows it never happened. */
async function abortRecorded(env: OpEnv, id: string, at: string) {
  const op = await readOp(env.db, id)
  if (op && (op.intent === "written" || op.intent === "late")) await writeLedger(env.ledger, entry(op, "abort", at))
}

/**
 * Copies made for a decision that never landed. An approval's copy is a key of its own, removed if nothing names it;
 * a restoration's copy shares its key with the published revision, whose file stays safe in held/, so it goes.
 */
async function cleanPrepared(env: OpEnv, kind: OpKind, detail: OpDetail) {
  if (!detail.prepared?.length) return
  try {
    if (kind === "approve") await retirePhotos(env.db, env.media, detail.prepared)
    else await env.media.delete(detail.prepared)
  } catch {
    // Left for the sweep: nothing serves a file the database doesn't make public.
  }
}

/** Moves a file, idempotently: done if it is already where it should be. */
async function move(media: R2Bucket, from: string, to: string) {
  const object = await media.get(from)
  if (!object) return
  await media.put(to, await object.arrayBuffer(), { httpMetadata: object.httpMetadata })
  await media.delete(from)
}
