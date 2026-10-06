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

/**
 * The page's own copy of every request it holds, written before the browser's. A browser that keeps nothing still
 * finds a request again within this page (a card closed and opened, another place visited), never after a reload.
 */
const memory = new Map<string, PendingReport>()
let version = 0
const listeners = new Set<() => void>()
const changed = () => {
  version++
  for (const l of listeners) l()
}
/** For a view that lists what is held: it changes whenever a request is kept or let go in this page. */
export const subscribeReports = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
export const reportsVersion = () => version

const unexpired = (all: Outbox, now: number) => Object.fromEntries(Object.entries(all).filter(([, r]) => r.expiresAt > now))
const dropExpired = (now: number) => {
  for (const [k, r] of memory) if (r.expiresAt <= now) memory.delete(k)
}
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

/** Keeps it before its first try: "stored" in this browser, or only "memory" (this page) when the browser keeps nothing. */
export async function remember(r: PendingReport): Promise<"stored" | "memory"> {
  memory.set(r.key, r)
  changed()
  try {
    await changeReportOutbox<PendingReport>((all) => ({ ...all, [r.key]: r }))
    return "stored"
  } catch {
    return "memory"
  }
}

/** Lets go of exactly this request (a late answer for one never clears another), saying whether the browser's copy went. */
export async function forget(key: string): Promise<"cleared" | "failed"> {
  memory.delete(key)
  changed()
  try {
    await changeReportOutbox<PendingReport>((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== key)))
    return "cleared"
  } catch (e) {
    return noStorage(e) ? "cleared" : "failed"
  }
}

/** Drops the requests past their window. Runs when the site starts and on every read: nothing runs while it is closed. */
export async function pruneReports(now = Date.now()): Promise<void> {
  dropExpired(now)
  // Never in the way of the site starting: a browser that can't do it now leaves it for the next read or visit.
  try {
    await changeReportOutbox<PendingReport>((all) => unexpired(all, now))
  } catch {
    /* kept for the next read, which drops expired requests too */
  }
}

/**
 * Every unexpired request this page or browser holds, newest first. `complete` is false when the browser's copy
 * couldn't be read: then a request may exist that isn't listed, and nothing may say there is none.
 */
export async function pendingReports(now = Date.now()): Promise<{ reports: PendingReport[]; complete: boolean }> {
  dropExpired(now)
  let stored: Outbox = {}
  let complete = true
  try {
    stored = await changeReportOutbox<PendingReport>((all) => unexpired(all, now))
  } catch (e) {
    complete = noStorage(e)
  }
  const all = new Map(Object.entries(stored))
  for (const [k, r] of memory) all.set(k, r)
  return { reports: [...all.values()].sort((a, b) => b.firstAttemptAt - a.firstAttemptAt), complete }
}

/** The newest unconfirmed request about a place, if one is still in its window; never an expired one. */
export async function pendingReport(placeId: string, now = Date.now()): Promise<{ report: PendingReport | null; complete: boolean }> {
  const { reports, complete } = await pendingReports(now)
  return { report: reports.find((r) => r.placeId === placeId) ?? null, complete }
}
