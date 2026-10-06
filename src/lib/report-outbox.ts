import { sendReport, type ReportSend } from "@/lib/api"
import { changeReportOutbox } from "@/lib/storage"
import type { ReportInput } from "@/shared/contract"

/**
 * How long a request is kept for a resend, from its first try, never extended by later ones (notice 10-3). The server
 * replays a key for as long as it keeps the request (months), so every resend in this window is the same request.
 */
export const REPORT_WINDOW_MS = 24 * 3600_000

/** A request as it was sent: the place, the body and the key stay together and never change. */
export type PendingReport = { key: string; placeId: string; payload: ReportInput; firstAttemptAt: number; expiresAt: number }
type Outbox = Record<string, PendingReport>

const unexpired = (all: Outbox, now: number) => Object.fromEntries(Object.entries(all).filter(([, r]) => r.expiresAt > now))

/** A new request, frozen for every try of it. */
export const freeze = (placeId: string, payload: ReportInput, key: string, now = Date.now()): PendingReport => ({
  key,
  placeId,
  payload,
  firstAttemptAt: now,
  expiresAt: now + REPORT_WINDOW_MS,
})

/** Keeps it in this browser before its first try; false when the browser keeps nothing (then it lives in the page). */
export async function remember(r: PendingReport): Promise<boolean> {
  try {
    await changeReportOutbox<PendingReport>((all) => ({ ...all, [r.key]: r }))
    return true
  } catch {
    return false
  }
}

/** Lets go of exactly this request: an answer that comes late for one never clears another. */
export async function forget(key: string): Promise<void> {
  await changeReportOutbox<PendingReport>((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== key))).catch(
    () => undefined,
  )
}

/** Drops the requests past their window. It can only happen when the site runs: nothing runs while the browser is closed. */
export async function pruneReports(now = Date.now()): Promise<void> {
  await changeReportOutbox<PendingReport>((all) => unexpired(all, now)).catch(() => undefined)
}

/** The unconfirmed request this browser sent about a place, if one is still in its window; never an expired one. */
export async function pendingReport(placeId: string, now = Date.now()): Promise<PendingReport | null> {
  try {
    const all = await changeReportOutbox<PendingReport>((stored) => unexpired(stored, now))
    return (
      Object.values(all)
        .filter((r) => r.placeId === placeId)
        .sort((a, b) => b.firstAttemptAt - a.firstAttemptAt)[0] ?? null
    )
  } catch {
    return null
  }
}

/**
 * What a try leaves the form showing. A refusal before any write speaks for that try alone: after an earlier try whose
 * fate is unknown, the request stays kept and locked, since that earlier try may have reached the server.
 */
export type Attempt =
  | { view: "result"; outcome: "hidden_for_review" | "received" }
  | { view: "pending"; reason: "unknown" | "conflict" | "refused"; code?: string }
  | { view: "editable"; code: string }

export function afterAttempt(sent: ReportSend, earlierUncertain: boolean): Attempt {
  if (sent.ok) return { view: "result", outcome: sent.outcome }
  if (sent.kind === "not_sent")
    return earlierUncertain ? { view: "pending", reason: "refused", code: sent.code } : { view: "editable", code: sent.code }
  return { view: "pending", reason: sent.kind }
}

/** One try of a kept request; the browser lets go of it once an answer settles it. */
export async function attempt(r: PendingReport, earlierUncertain: boolean): Promise<Attempt> {
  const next = afterAttempt(await sendReport(r.payload, r.key), earlierUncertain)
  if (next.view !== "pending") await forget(r.key)
  return next
}
