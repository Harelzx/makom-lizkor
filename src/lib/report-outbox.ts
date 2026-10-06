import { RETENTION } from "@/config"
import { changeReportOutbox } from "@/lib/storage"
import type { ReportInput } from "@/shared/contract"

/**
 * How long a request is kept for a resend, from its first try, never extended by later ones (notice 10-3). The server
 * replays a key for as long as it keeps the request (months), so every resend in this window is the same request.
 */
export const REPORT_WINDOW_MS = RETENTION.reportOutboxHours * 3600_000

/** A request as it was sent: the place, the body and the key stay together and never change. */
export type PendingReport = { key: string; placeId: string; payload: ReportInput; firstAttemptAt: number; expiresAt: number }
type Outbox = Record<string, PendingReport>

// The browser's copy only. The page's own copy, and everything a page does with a request, is src/lib/report-holder.ts.
const unexpired = (all: Outbox, now: number) => Object.fromEntries(Object.entries(all).filter(([, r]) => r.expiresAt > now))
// A browser with no storage at all kept nothing, so nothing of it is unread or left behind; any other failure might have.
const noStorage = (e: unknown) => e instanceof Error && e.message === "storage_unavailable"

/** A new request, frozen for every try of it. */
export const freeze = (placeId: string, payload: ReportInput, key: string, now = Date.now()): PendingReport => ({
  key,
  placeId,
  payload,
  firstAttemptAt: now,
  expiresAt: now + REPORT_WINDOW_MS,
})

/** Keeps it in this browser before its first try: "stored", or "memory" when the browser keeps nothing (this page only). */
export async function remember(r: PendingReport): Promise<"stored" | "memory"> {
  try {
    await changeReportOutbox<PendingReport>((all) => ({ ...all, [r.key]: r }))
    return "stored"
  } catch {
    return "memory"
  }
}

/** Removes exactly this request's copy (a late answer for one never clears another), saying whether it went. */
export async function forget(key: string): Promise<"cleared" | "failed"> {
  try {
    await changeReportOutbox<PendingReport>((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== key)))
    return "cleared"
  } catch (e) {
    return noStorage(e) ? "cleared" : "failed"
  }
}

/** Drops the requests past their window. Runs when the site starts and whenever the page checks its deadlines. */
export async function pruneReports(now = Date.now()): Promise<void> {
  // Never in the way of the site starting: a browser that can't do it now leaves it for the next check or visit.
  try {
    await changeReportOutbox<PendingReport>((all) => unexpired(all, now))
  } catch {
    /* tried again at the next check */
  }
}

/**
 * The unexpired requests this browser holds, newest first. `complete` is false when its copy couldn't be read: then
 * a request may exist that isn't listed, and nothing may say there is none.
 */
export async function storedReports(now = Date.now()): Promise<{ reports: PendingReport[]; complete: boolean }> {
  try {
    const all = await changeReportOutbox<PendingReport>((stored) => unexpired(stored, now))
    return { reports: Object.values(all).sort((a, b) => b.firstAttemptAt - a.firstAttemptAt), complete: true }
  } catch (e) {
    return { reports: [], complete: noStorage(e) }
  }
}
