import { sendReport, type ReportSend } from "@/lib/api"
import { forget, pruneReports, remember, storedReports, type PendingReport } from "@/lib/report-outbox"

/**
 * What a try leaves showing. A refusal before any write speaks for that try alone: after an earlier try whose fate is
 * unknown, the request stays kept and locked, since that earlier try may have reached the server. `cleared` says whether
 * the browser's copy went once the request was settled or expired.
 */
export type Attempt =
  | { view: "result"; outcome: "hidden_for_review" | "received"; cleared: boolean }
  | { view: "pending"; reason: "unknown" | "conflict" | "refused"; code?: string }
  | { view: "editable"; code: string; cleared: boolean }
  | { view: "expired"; cleared: boolean }

type Answer = Exclude<ReportSend, { kind: "expired" }>
type Settle = { view: "result"; outcome: "hidden_for_review" | "received" } | { view: "editable"; code: string }
export function afterAttempt(sent: Answer, earlierUncertain: boolean): Settle | Extract<Attempt, { view: "pending" }> {
  if (sent.ok) return { view: "result", outcome: sent.outcome }
  if (sent.kind === "not_sent")
    return earlierUncertain ? { view: "pending", reason: "refused", code: sent.code } : { view: "editable", code: sent.code }
  return { view: "pending", reason: sent.kind }
}

/** One try of a kept request; never at or past its deadline (then it is let go unsent), and let go once an answer settles it. */
export async function attempt(r: PendingReport, earlierUncertain: boolean, now = Date.now()): Promise<Attempt> {
  const expired = async (): Promise<Attempt> => ({ view: "expired", cleared: (await forget(r.key)) === "cleared" })
  if (now >= r.expiresAt) return expired()
  const sent = await sendReport(r.payload, r.key, r.expiresAt)
  if (!sent.ok && sent.kind === "expired") return expired()
  const next = afterAttempt(sent as Answer, earlierUncertain)
  if (next.view === "pending") return next
  return { ...next, cleared: (await forget(r.key)) === "cleared" }
}

export type Shown = Attempt | { view: "restored" } | { view: "discarded"; cleared: boolean }
/** A request this page knows of, by its key. Every view of it (its place's card, the list of places not shown) reads this. */
export type Entry = {
  key: string
  placeId: string
  /** the request as sent, while it may still go again; released once settled, removed or past its deadline */
  r: PendingReport | null
  expiresAt: number
  /** whether any try of it may have reached the server */
  uncertain: boolean
  /** whether this browser kept it (false: this page only) */
  stored: boolean
  busy: boolean
  shown: Shown | null
}

/**
 * The page's requests, shared by every view and kept across a card closing and opening: it is also the page's own copy,
 * so a browser that keeps nothing (or refused a removal) still finds a request again until a reload. Operations on one
 * request run one at a time, whichever view asks (one asked for while another runs is refused), and its deadline is kept
 * here, for the whole page, not by whichever view happens to be open.
 */
const entries = new Map<string, Entry>()
// Settled or expired requests whose browser copy couldn't be removed: tried again at each check, never sent or shown.
const leftover = new Set<string>()
let read: "unread" | "ok" | "failed" = "unread"
let reading: Promise<void> | null = null
let version = 0
const listeners = new Set<() => void>()
const changed = () => {
  version++
  for (const l of listeners) l()
}
export const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
export const reportsVersion = () => version
export const entry = (key: string | null) => (key ? entries.get(key) : undefined)
/** The newest request about a place that can still go again. */
export const heldFor = (placeId: string) =>
  [...entries.values()].filter((e) => e.placeId === placeId && e.r).sort((a, b) => b.r!.firstAttemptAt - a.r!.firstAttemptAt)[0]
export const allEntries = () => [...entries.values()]
/** True when the browser's copy couldn't be read, so a request may exist that this page doesn't know of. */
export const readFailed = () => read === "failed"

const patch = (key: string, p: Partial<Entry>) => {
  const e = entries.get(key)
  if (!e) return
  entries.set(key, { ...e, ...p })
  changed()
}
const release = (key: string, shown: Shown, cleared: boolean) => {
  if (!cleared) leftover.add(key)
  patch(key, { r: null, uncertain: false, shown })
}

async function run(key: string, op: () => Promise<void>) {
  const e = entries.get(key)
  if (!e || e.busy) return false
  patch(key, { busy: true })
  try {
    await op()
  } finally {
    patch(key, { busy: false })
    watch()
  }
  return true
}

async function tryOnce(key: string) {
  const e = entries.get(key)
  if (!e?.r) return
  let next: Attempt
  try {
    next = await attempt(e.r, e.uncertain)
  } catch {
    // Whatever broke, the request may have gone: it stays kept, and is said to be unconfirmed.
    next = { view: "pending", reason: "unknown" }
  }
  if (next.view === "pending") patch(key, { uncertain: true, shown: next })
  else release(key, next, next.cleared)
}

/** Reads the browser's copy into the page (once it has worked; again after a failure, when asked). */
export function hydrate(): Promise<void> {
  if (read === "ok") return Promise.resolve()
  reading ??= (async () => {
    const { reports, complete } = await storedReports()
    for (const r of reports)
      if (!entries.has(r.key) && !leftover.has(r.key))
        entries.set(r.key, {
          key: r.key,
          placeId: r.placeId,
          r,
          expiresAt: r.expiresAt,
          uncertain: true,
          stored: true,
          busy: false,
          shown: { view: "restored" },
        })
    read = complete ? "ok" : "failed"
    reading = null
    changed()
    watch()
  })()
  return reading
}

/** A new request: kept before its first try (in the page, and in the browser when it allows), then tried. */
export function start(r: PendingReport) {
  if (entries.has(r.key)) return Promise.resolve(false)
  entries.set(r.key, {
    key: r.key,
    placeId: r.placeId,
    r,
    expiresAt: r.expiresAt,
    uncertain: false,
    stored: true,
    busy: false,
    shown: null,
  })
  changed()
  return run(r.key, async () => {
    patch(r.key, { stored: (await remember(r)) === "stored" })
    await tryOnce(r.key)
  })
}

/** The kept request again, exactly as it was. */
export const resend = (key: string) => run(key, () => tryOnce(key))

/** Lets go of it here, at the visitor's word; that says nothing about whether it arrived. A refused removal keeps it held. */
export const discard = (key: string) =>
  run(key, async () => {
    if (!entries.get(key)?.r) return
    const cleared = (await forget(key)) === "cleared"
    if (cleared) release(key, { view: "discarded", cleared }, cleared)
    else patch(key, { shown: { view: "discarded", cleared } })
  })

/** Past its deadline a request is let go unsent, whatever is open; what happened to it stays unknown. */
export const expire = (key: string) =>
  run(key, async () => {
    const e = entries.get(key)
    if (!e?.r || Date.now() < e.expiresAt) return
    const cleared = (await forget(key)) === "cleared"
    release(key, { view: "expired", cleared }, cleared)
  })

/** A view is done with a settled request: nothing of it remains in the page. */
export function dismiss(key: string) {
  const e = entries.get(key)
  if (e && !e.r && !e.busy) {
    entries.delete(key)
    changed()
  }
}

/** Every deadline that has come, every copy still owed a removal, and the browser's expired copies. */
export async function check() {
  for (const e of [...entries.values()]) if (e.r && Date.now() >= e.expiresAt) await expire(e.key)
  for (const key of [...leftover]) if ((await forget(key)) === "cleared") leftover.delete(key)
  await pruneReports()
  watch()
}

// One timer for the page: the next deadline, or a minute while a removal is owed. Also on coming back to a page that
// slept through it (a timer doesn't run in a sleeping laptop).
let timer: ReturnType<typeof setTimeout> | undefined
let listening = false
function watch() {
  if (!listening && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => void check())
    listening = true
  }
  clearTimeout(timer)
  const due = [...entries.values()].filter((e) => e.r && !e.busy).map((e) => e.expiresAt)
  const next = Math.min(...due, leftover.size ? Date.now() + 60_000 : Infinity)
  if (next < Infinity) timer = setTimeout(() => void check(), Math.max(0, next - Date.now()))
}
