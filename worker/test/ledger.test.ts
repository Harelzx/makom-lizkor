import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { ledgerKey, replayDecision, writeLedger, type LedgerEntry } from "../lib/ledger"

const at = "2026-10-06T08:00:00.000Z"
/** One ledger entry; a step of the place's chain from `seq` to `seq + 1`. */
function entry(
  op: string,
  phase: LedgerEntry["phase"],
  kind: LedgerEntry["kind"],
  seq: number,
  extra: Partial<LedgerEntry> = {},
): LedgerEntry {
  const removal = kind === "withdraw" || kind === "suppress"
  return {
    op,
    place: "p_x",
    phase,
    kind,
    actor: "moderator",
    seq_from: seq,
    seq_to: seq + 1,
    rev_from: seq + 3,
    rev_to: seq + 4,
    removal,
    at,
    ...extra,
  }
}
const ops = (r: ReturnType<typeof replayDecision>) => r.apply.map((e) => `${e.op}:${e.phase}`)

describe("replay rules (spec 8.2)", () => {
  it("applies a committed decision, and a removal whose intent was written even without its commit", () => {
    const r = replayDecision(
      [entry("a", "intent", "approve", 0), entry("a", "commit", "approve", 0), entry("h", "intent", "suppress", 1)],
      0,
    )
    expect(ops(r)).toEqual(["a:commit", "h:intent"])
    expect(r.quarantine).toBe(false)
  })

  it("never applies a publication or a restoration that has an intent and no commit", () => {
    const r = replayDecision([entry("a", "intent", "approve", 0), entry("l", "intent", "lift", 0)], 0)
    expect(ops(r)).toEqual([])
  })

  it("a removal whose intent lost the race to a committed decision still applies: removal wins", () => {
    const r = replayDecision(
      [entry("a", "intent", "approve", 2), entry("a", "commit", "approve", 2), entry("h", "intent", "suppress", 2)],
      2,
    )
    expect(ops(r)).toEqual(["a:commit", "h:intent"])
    expect(r.quarantine).toBe(false)
  })

  it("a removal recorded as refused (intent, then abort) is not replayed: the record is complete, and it didn't happen", () => {
    const r = replayDecision([entry("h", "intent", "suppress", 0), entry("h", "abort", "suppress", 0)], 0)
    expect(ops(r)).toEqual([])
  })

  it("a gap in the chain keeps the place hidden until a moderator looks", () => {
    // From seq 0, the next recorded decision starts at 1: the step 0 -> 1 is missing.
    expect(replayDecision([entry("a", "commit", "approve", 1)], 0).quarantine).toBe(true)
    expect(replayDecision([entry("a", "commit", "approve", 0), entry("b", "commit", "suppress", 2)], 0).quarantine).toBe(true)
    expect(replayDecision([entry("a", "commit", "approve", 0), entry("b", "commit", "suppress", 1)], 0).quarantine).toBe(false)
  })

  it("a withdrawal or an erasure in the ledger, as intent or as commit, blocks the place for good", () => {
    expect(replayDecision([entry("w", "intent", "withdraw", 3)], 0).erased).toBe(true)
    expect(replayDecision([entry("e", "commit", "erase", 3)], 0).erased).toBe(true)
    expect(replayDecision([entry("a", "commit", "approve", 0)], 0).erased).toBe(false)
  })

  it("orders the chain by the place's own sequence, not by when entries were written or listed", () => {
    const r = replayDecision([entry("b", "commit", "lift", 1), entry("a", "commit", "suppress", 0)], 0)
    expect(ops(r)).toEqual(["a:commit", "b:commit"])
  })
})

describe("writing the ledger", () => {
  it("keeps one object per entry under the place, in chain order, holding ids and codes only", async () => {
    const e = entry("t_01", "intent", "suppress", 7, { fields: ["story_he"], basis: undefined })
    expect(ledgerKey(e)).toBe("ledger/p_x/00000007-t_01-intent.json")
    expect(await writeLedger(env.LEDGER, e)).toBe(true)
    const stored = await (await env.LEDGER.get(ledgerKey(e)))!.json<LedgerEntry>()
    expect(stored).toEqual(e)
  })

  it("answers false instead of throwing when the bucket refuses", async () => {
    const broken = { put: async () => Promise.reject(new Error("down")) } as unknown as R2Bucket
    expect(await writeLedger(broken, entry("t_02", "commit", "approve", 0))).toBe(false)
  })
})
