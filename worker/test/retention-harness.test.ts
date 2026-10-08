import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
// The standalone Node evidence tool intentionally has no TypeScript declaration file.
// @ts-expect-error Import the exact guards used by the cloud restore rehearsal.
import { assertCohort, assertReport } from "../../tools/l-ret/guards.mjs"
import { EXPORT_TABLES } from "../db/exports"
import { importExport, type ExportPayload } from "../db/import"
import { reconcileTables } from "../db/reconcile"
import { replayLedger } from "../db/replay"
import { retentionCutoffs } from "../db/retention"
import { durations } from "../lib/durations"
import type { LedgerEntry } from "../lib/ledger"

const days = durations({ ENVIRONMENT: "staging", RETENTION_DAY_SECONDS: "7200" })
const E = new Date("2026-10-08T10:00:00.000Z")
const at = (n: number, ms = 0) => new Date(E.getTime() + n * days.day + ms)
const MARKER = "synthetic retention rehearsal text"
const PLACE = "p_harness"
const REPORT = "r_harness"
type Row = Record<string, unknown>

beforeAll(() => applyD1Migrations(env.IMPORT_TEST, env.TEST_MIGRATIONS))
beforeEach(async () => {
  for (const table of [...EXPORT_TABLES].reverse()) await env.IMPORT_TEST.prepare(`DELETE FROM ${table}`).run()
})

async function exported(role?: "returned" | "rejected"): Promise<ExportPayload> {
  const tables: ExportPayload["tables"] = Object.fromEntries(EXPORT_TABLES.map((table) => [table, []]))
  if (role) {
    tables.places.push({
      id: PLACE,
      origin: "contribution",
      status: role,
      rev: 2,
      ledger_seq: 1,
      created_at: at(-2).toISOString(),
      status_changed_at: at(-1).toISOString(),
      erased_reason: null,
    })
    tables.revisions.push({
      id: "v_harness",
      place_id: PLACE,
      n: 1,
      state: role,
      name_he: MARKER,
      decision_note: MARKER,
      created_at: at(-2).toISOString(),
      decided_at: at(-1).toISOString(),
    })
  }
  const schema = await env.IMPORT_TEST.prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1").first<string>("name")
  return { format: 1, id: "ex_harness", created_at: E.toISOString(), schema, tables }
}

function erasure(phase: LedgerEntry["phase"]): LedgerEntry {
  return {
    op: "op_harness",
    place: PLACE,
    phase,
    kind: "erase",
    actor: "automatic",
    seq_from: 1,
    seq_to: 2,
    rev_from: 2,
    rev_to: 3,
    removal: true,
    status: "erased",
    at: at(1).toISOString(),
  }
}

async function restore(payload: ExportPayload, now: Date, entries: LedgerEntry[] = []) {
  const ledger = new Map(entries.length ? [[PLACE, entries]] : [])
  const source = reconcileTables(payload.tables, ledger, now, payload.created_at, days).tables
  expect(await importExport(env.IMPORT_TEST, payload, now, ledger, days)).toMatchObject({ ok: true })
  // The rehearsal performs the same idempotent follow-up as the real isolated restore.
  await replayLedger(env.IMPORT_TEST, ledger, now, payload.created_at, days)
  return source
}

async function checkCohort(role: string, source: Row, now: Date) {
  const restored = await env.IMPORT_TEST.prepare("SELECT status, erased_reason FROM places WHERE id = ?").bind(PLACE).first()
  const marked = await env.IMPORT_TEST.prepare(
    "SELECT COUNT(*) AS n FROM revisions WHERE place_id = ? AND (name_he LIKE ? OR decision_note LIKE ?)",
  )
    .bind(PLACE, `%${MARKER}%`, `%${MARKER}%`)
    .first<number>("n")
  assertCohort({ id: PLACE, role }, source, restored, marked, retentionCutoffs(now, days))
  return restored
}

describe("the evidence oracle follows the actual reconciled import and replay", () => {
  for (const role of ["returned", "rejected"] as const) {
    for (const via of ["expiry", "committed erase", "uncommitted removal", "aborted erase"] as const) {
      it(`${role}: accepts ${via} with the exact reason, but rejects corrupted reasons and retained text`, async () => {
        const payload = await exported(role)
        const entries =
          via === "expiry"
            ? []
            : via === "committed erase"
              ? [erasure("commit")]
              : via === "uncommitted removal"
                ? [erasure("intent")]
                : [erasure("intent"), erasure("abort")]
        const now = at(30)
        const source = (await restore(payload, now, entries)).places[0]
        const expectedReason = via === "expiry" || via === "aborted erase" ? `${role}_expired` : "restored"
        expect(await checkCohort(role, source, now)).toMatchObject({ status: "erased", erased_reason: expectedReason })

        // Known but inapplicable reasons must fail just as unknown reasons do: this is not a reason allowlist alone.
        for (const reason of ["unknown", expectedReason === "restored" ? `${role}_expired` : "restored"]) {
          await env.IMPORT_TEST.prepare("UPDATE places SET erased_reason = ? WHERE id = ?").bind(reason, PLACE).run()
          await expect(checkCohort(role, source, now)).rejects.toThrow("Unexpected erasure reason")
        }
        await env.IMPORT_TEST.prepare("UPDATE places SET erased_reason = ? WHERE id = ?").bind(expectedReason, PLACE).run()
        await env.IMPORT_TEST.prepare("UPDATE revisions SET decision_note = ? WHERE place_id = ?").bind(MARKER, PLACE).run()
        await expect(checkCohort(role, source, now)).rejects.toThrow("Removed cohort text returned")
      })
    }
  }

  it("uses the later ledger decision date instead of a stale receipt role or expiry date", async () => {
    const payload = await exported("returned")
    payload.tables.places[0].status_changed_at = at(-40).toISOString()
    const entry: LedgerEntry = {
      ...erasure("commit"),
      kind: "reject",
      revision: "v_harness",
      status: "rejected",
      decided_at: at(1).toISOString(),
    }
    const now = at(2)
    const source = (await restore(payload, now, [entry])).places[0]
    expect(await checkCohort("returned", source, now)).toMatchObject({ status: "rejected", erased_reason: null })
  })
})

function report(status: "open" | "in_review" | "closed", deadline = 360): Row {
  return {
    id: REPORT,
    place_id: PLACE,
    origin: "contribution",
    elements: '["story_he"]',
    requester_type: "family",
    relationship: MARKER,
    explanation: MARKER,
    email: "synthetic@example.test",
    notice_version: "v_synthetic",
    submit_key_hash: "synthetic_key",
    body_hash: "synthetic_body",
    explanation_hash: null,
    reporter_key: null,
    complete: 1,
    outcome: "received",
    status,
    received_at: E.toISOString(),
    ceiling_at: at(360).toISOString(),
    purge_after: at(deadline).toISOString(),
  }
}

async function checkReport(source: Row, bounded: Row, now: Date) {
  const restored = await env.IMPORT_TEST.prepare(
    "SELECT explanation, reporter_key, explanation_hash, purge_after FROM reports WHERE id = ?",
  )
    .bind(REPORT)
    .first()
  assertReport(source, restored, now, bounded)
  return restored
}

describe("the report oracle applies the export-time recovery bound", () => {
  for (const status of ["open", "in_review"] as const) {
    for (const offset of [-1, 0]) {
      it(`${status}: preserves text before, and blanks at, the shortened 90-day deadline (offset ${offset} ms)`, async () => {
        const payload = await exported()
        const original = report(status)
        payload.tables.reports.push(original)
        const now = at(90, offset)
        const bounded = (await restore(payload, now)).reports[0]
        expect(await checkReport(original, bounded, now)).toMatchObject({
          purge_after: at(90).toISOString(),
          explanation: offset < 0 ? MARKER : null,
        })
        if (offset === 0) {
          await env.IMPORT_TEST.prepare("UPDATE reports SET explanation = ? WHERE id = ?").bind(MARKER, REPORT).run()
          await expect(checkReport(original, bounded, now)).rejects.toThrow("explanation does not match")
          await env.IMPORT_TEST.prepare("UPDATE reports SET explanation = NULL, purge_after = ? WHERE id = ?")
            .bind(original.purge_after, REPORT)
            .run()
          await expect(checkReport(original, bounded, now)).rejects.toThrow("retention deadline does not match recovery bound")
        }
      })
    }
  }

  it("does not shorten an already closed report's original deadline", async () => {
    const payload = await exported()
    const original = report("closed")
    payload.tables.reports.push(original)
    const now = at(90)
    const bounded = (await restore(payload, now)).reports[0]
    expect(await checkReport(original, bounded, now)).toMatchObject({ purge_after: at(360).toISOString(), explanation: MARKER })
  })

  it("keeps an earlier original deadline instead of extending it to the recovery bound", async () => {
    const payload = await exported()
    const original = report("open", 20)
    payload.tables.reports.push(original)
    const now = at(20)
    const bounded = (await restore(payload, now)).reports[0]
    expect(await checkReport(original, bounded, now)).toMatchObject({ purge_after: at(20).toISOString(), explanation: null })
  })
})
