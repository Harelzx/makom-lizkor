/**
 * The ledger (spec 8.2): every decision, written as an intent before it reaches the database and as a commit after,
 * outside D1, so a restore from backup can replay what was decided since. It holds ids and codes only: the place, the
 * operation, the step of the place's chain, the kind, field names and file keys. Never what anyone wrote, never a
 * contact detail, so keeping it for the life of the project keeps nothing personal.
 */

export type OpKind = "approve" | "reject" | "return" | "withdraw" | "suppress" | "lift" | "erase"
export type Actor = "moderator" | "automatic" | "submitter"

export type LedgerEntry = {
  op: string
  place: string
  phase: "intent" | "commit"
  kind: OpKind
  actor: Actor
  /** The place's chain of recorded decisions: this one moves it from seq_from to seq_to. */
  seq_from: number
  seq_to: number
  rev_from: number
  rev_to: number
  /** Whether it takes something out of public view: such an intent is replayed even without its commit. */
  removal: boolean
  /** On a commit: the place's status after the decision. */
  status?: string
  fields?: string[]
  media?: string[]
  basis?: string
  at: string
  /** An intent written after the decision, because the bucket refused it at the time (a removal that went ahead). */
  late?: boolean
}

/** One object per entry, under its place, named so a listing comes back in chain order. */
export const ledgerKey = (e: Pick<LedgerEntry, "place" | "seq_from" | "op" | "phase">) =>
  `ledger/${e.place}/${String(e.seq_from).padStart(8, "0")}-${e.op}-${e.phase}.json`

/** Writes one entry; false, never a throw, when the bucket refuses, so the caller decides what a missing record means. */
export async function writeLedger(bucket: R2Bucket, e: LedgerEntry): Promise<boolean> {
  try {
    await bucket.put(ledgerKey(e), JSON.stringify(e), { httpMetadata: { contentType: "application/json" } })
    return true
  } catch {
    return false
  }
}

const ERASING: OpKind[] = ["withdraw", "erase"]

/**
 * What a replay from a restore point does with one place's entries, given the place's chain step at that point.
 *
 * - A committed decision is applied, in chain order.
 * - A removal with an intent and no commit is applied anyway: when the record is incomplete, removal wins.
 * - A publication, a restoration or anything else with an intent and no commit is not.
 * - A step missing from the committed chain quarantines the place: its elements stay hidden until a moderator looks.
 * - A withdrawal or an erasure, as intent or commit, blocks the place and its files from ever coming back.
 *
 * Phase 5's restore runs this; it is pure so the rules are tested apart from any bucket.
 */
export function replayDecision(entries: LedgerEntry[], fromSeq: number): { apply: LedgerEntry[]; quarantine: boolean; erased: boolean } {
  const byOp = new Map<string, { intent?: LedgerEntry; commit?: LedgerEntry }>()
  for (const e of entries) {
    const seen = byOp.get(e.op) ?? {}
    seen[e.phase] = e
    byOp.set(e.op, seen)
  }
  const committed: LedgerEntry[] = []
  const removals: LedgerEntry[] = []
  for (const { intent, commit } of byOp.values()) {
    if (commit) committed.push(commit)
    else if (intent?.removal) removals.push(intent)
  }
  committed.sort((a, b) => a.seq_from - b.seq_from)
  removals.sort((a, b) => a.seq_from - b.seq_from)
  let step = fromSeq
  let quarantine = false
  for (const c of committed) {
    if (c.seq_from !== step) quarantine = true
    step = c.seq_to
  }
  return { apply: [...committed, ...removals], quarantine, erased: entries.some((e) => ERASING.includes(e.kind)) }
}
