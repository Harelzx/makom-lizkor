import { z } from "zod"

// The /api/ops summary's schema on its own (no database code), so a script can print its JSON Schema for the
// committed snapshot (worker/lib/ops-summary.schema.json) that the release manifest watches.

const count = z.number().int().nonnegative()
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/)
const code = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/)
const counts = z.record(code, count)

export const PLACE_STATUSES = ["pending", "returned", "published", "hidden", "rejected", "withdrawn", "erased"] as const
export const REPORT_STATUSES = ["open", "in_review", "closed"] as const
export const ATTENTION = ["interrupted", "ledger_repair", "media_failed", "purge_abandoned"] as const
/** A submission or correction waiting longer than this is overdue (spec 7: the moderation target). */
export const OVERDUE_DAYS = 14

const byKeys = <const K extends readonly string[]>(keys: K) =>
  z.object(Object.fromEntries(keys.map((k) => [k, count])) as { [P in K[number]]: typeof count }).strict()

export const OpsSummary = z
  .object({
    generated_at: iso,
    places: byKeys(PLACE_STATUSES),
    queue: z.object({ pending: count, overdue: count, overdue_days: z.literal(OVERDUE_DAYS) }).strict(),
    reports: byKeys(REPORT_STATUSES),
    attention: byKeys(ATTENTION),
    retention: z
      .object({
        last: z.object({ started_at: iso, finished_at: iso.nullable(), ok: z.boolean(), counts }).strict().nullable(),
        unfinished: count,
      })
      .strict(),
    export: z.object({ created_at: iso, ok: z.boolean() }).strict().nullable(),
    drill: z.object({ started_at: iso, ok: z.boolean().nullable(), failure: code.nullable() }).strict().nullable(),
    deletion_check: counts,
    alerts: z.array(z.object({ job: code, sent_at: iso }).strict()),
    errors: z.discriminatedUnion("status", [
      z.object({ status: z.literal("unavailable") }).strict(),
      z
        .object({
          status: z.literal("ok"),
          window_hours: count,
          requests: count,
          by_code: counts,
          per_thousand: z.record(code, z.number().nonnegative()),
        })
        .strict(),
    ]),
  })
  .strict()
export type OpsSummary = z.infer<typeof OpsSummary>
