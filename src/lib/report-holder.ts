import { sendReport, type ReportSend } from "@/lib/api"
import { forget, remember, type PendingReport } from "@/lib/report-outbox"

/**
 * What a try leaves the form showing. A refusal before any write speaks for that try alone: after an earlier try whose
 * fate is unknown, the request stays kept and locked, since that earlier try may have reached the server. `cleared`
 * says whether the browser's copy went once the request was settled.
 */
export type Attempt =
  | { view: "result"; outcome: "hidden_for_review" | "received"; cleared: boolean }
  | { view: "pending"; reason: "unknown" | "conflict" | "refused"; code?: string }
  | { view: "editable"; code: string; cleared: boolean }
  | { view: "expired"; cleared: boolean }

type Settle = { view: "result"; outcome: "hidden_for_review" | "received" } | { view: "editable"; code: string }
export function afterAttempt(sent: ReportSend, earlierUncertain: boolean): Settle | Extract<Attempt, { view: "pending" }> {
  if (sent.ok) return { view: "result", outcome: sent.outcome }
  if (sent.kind === "not_sent")
    return earlierUncertain ? { view: "pending", reason: "refused", code: sent.code } : { view: "editable", code: sent.code }
  return { view: "pending", reason: sent.kind }
}

/** One try of a kept request; never past its window (then it is let go unsent), and let go once an answer settles it. */
export async function attempt(r: PendingReport, earlierUncertain: boolean, now = Date.now()): Promise<Attempt> {
  if (now >= r.expiresAt) return { view: "expired", cleared: (await forget(r.key)) === "cleared" }
  const next = afterAttempt(await sendReport(r.payload, r.key), earlierUncertain)
  if (next.view === "pending") return next
  return { ...next, cleared: (await forget(r.key)) === "cleared" }
}

export type Shown = Attempt | { view: "restored" } | { view: "unread" } | { view: "discarded"; cleared: boolean }
export type HolderState = {
  /** the request as sent, while what happened to it isn't known: it can only go again as it was, or be let go */
  kept: PendingReport | null
  /** whether any try of it may have reached the server */
  uncertain: boolean
  /** whether this browser kept it (false: this page only) */
  stored: boolean
  busy: boolean
  shown: Shown | null
}

/**
 * The one request a form (or the list of requests about places not shown) holds. Operations run one at a time: a send,
 * a resend, a removal and an expiry never overlap, and one asked for while another runs is refused. Each checks, after
 * every wait, that it still holds the request it began with, so nothing late lands on another.
 */
export function createHolder(clock: () => number = Date.now) {
  let state: HolderState = { kept: null, uncertain: false, stored: true, busy: false, shown: null }
  const listeners = new Set<() => void>()
  const set = (patch: Partial<HolderState>) => {
    state = { ...state, ...patch }
    for (const l of listeners) l()
  }
  const holds = (key: string) => state.kept?.key === key
  const run = async (op: () => Promise<void>) => {
    if (state.busy) return false
    set({ busy: true })
    try {
      await op()
    } finally {
      set({ busy: false })
    }
    return true
  }
  const tryOnce = async (r: PendingReport) => {
    const next = await attempt(r, state.uncertain, clock())
    if (!holds(r.key)) return
    if (next.view === "pending") set({ uncertain: true, shown: next })
    else set({ kept: null, uncertain: false, shown: next })
  }
  return {
    get: () => state,
    subscribe(l: () => void) {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    /** A request sent from here earlier, found again: whether it arrived isn't known. */
    restore(r: PendingReport) {
      if (!state.kept && !state.busy) set({ kept: r, uncertain: true, stored: true, shown: { view: "restored" } })
    },
    /** The browser's copy couldn't be read, so an earlier request may exist unseen: said, never shown as none. */
    unread() {
      if (!state.kept) set({ shown: { view: "unread" } })
    },
    /** A new request: kept before its first try, then tried. */
    start: (r: PendingReport) =>
      run(async () => {
        if (state.kept) return
        set({ kept: r, uncertain: false, shown: null })
        set({ stored: (await remember(r)) === "stored" })
        if (holds(r.key)) await tryOnce(r)
      }),
    /** The kept request again, exactly as it was. */
    resend: () =>
      run(async () => {
        if (state.kept) await tryOnce(state.kept)
      }),
    /** Lets go of it here, at the visitor's word. That says nothing about whether it arrived. */
    discard: () =>
      run(async () => {
        const r = state.kept
        if (!r) return
        const cleared = (await forget(r.key)) === "cleared"
        if (!holds(r.key)) return
        // A copy that couldn't be removed stays held, so the removal can be asked for again.
        set(cleared ? { kept: null, uncertain: false, shown: { view: "discarded", cleared } } : { shown: { view: "discarded", cleared } })
      }),
    /** Past its window the request is let go unsent, in an open page too; what happened to it stays unknown. */
    expire: () =>
      run(async () => {
        const r = state.kept
        if (!r || clock() < r.expiresAt) return
        const cleared = (await forget(r.key)) === "cleared"
        if (holds(r.key)) set({ kept: null, uncertain: false, shown: { view: "expired", cleared } })
      }),
  }
}
export type Holder = ReturnType<typeof createHolder>
