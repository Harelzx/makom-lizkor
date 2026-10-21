import { useCallback, useEffect, useMemo, useState } from "react"
import { ELEMENT_LABEL } from "@/data/reports"
import type { Element } from "@/shared/contract"
import { createPager, type PagerState } from "./pager"
import { fetchPage, fetchQueue, transition, type Action, type Attention, type Item, type Report } from "./api"

/**
 * What both layouts read and do: the three lists (submissions, removal requests, stuck operations), the order a
 * session reads them in, the chosen item, and a decision that brings the next one in. The layouts differ in how they
 * show it, never in what a moderator can do.
 */
export type Selection = { kind: "report" | "proposal"; id: string }
export type Filter = "all" | "reports" | "proposals"
export const same = (a: Selection | null, b: Selection | null) => !!a && !!b && a.kind === b.kind && a.id === b.id

const DAY = 86_400_000
/** Two weeks is when the queue's own reminders call a submission late. */
export const overdue = (item: Item) => Date.now() - new Date(item.created_at).getTime() > 14 * DAY
/** A request whose item was taken down as a precaution and still waits on a decision: the urgent ones. */
export const urgent = (r: Report) => r.outcome === "hidden_for_review" && r.status !== "closed"
export const reportName = (r: Report) => r.place_name ?? r.place_id
export const elementsOf = (r: Report) => (JSON.parse(r.elements) as Element[]).map((e) => ELEMENT_LABEL[e])

/** When something arrived, as a person says it, counted in Israel's calendar days whatever the browser's zone. */
export function ago(iso: string) {
  const zone = { timeZone: "Asia/Jerusalem" }
  const day = (d: Date) => Date.parse(d.toLocaleDateString("en-CA", zone))
  const at = new Date(iso)
  const minutes = Math.round((Date.now() - at.getTime()) / 60_000)
  if (minutes < 60) return minutes <= 1 ? "עכשיו" : `לפני ${minutes} דקות`
  const days = Math.round((day(new Date()) - day(at)) / DAY)
  const time = at.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", ...zone })
  return days <= 0 ? `היום, ${time}` : days === 1 ? `אתמול, ${time}` : days === 2 ? "לפני יומיים" : `לפני ${days} ימים`
}

/** What a decision says once it is saved, in the action's own words. */
export const DONE: Record<Action, string> = {
  approve: "המקום פורסם באתר",
  return: "ההצעה הוחזרה לשולח לתיקון",
  reject: "ההצעה נדחתה",
}

/** A paged list as React state; its refresh and more are stable, so they can be effect dependencies. */
export function usePaged<T>(path: string, key: "items" | "ops") {
  const [state, setState] = useState<PagerState<T>>({ items: null, next: null, error: "", failed: null, busy: false })
  const [pager] = useState(() => createPager<T>((cursor) => fetchPage<T>(path, key, cursor), setState))
  return { ...state, ...pager }
}

export type Said = { text: string; n: number; tone: "done" | "error" }

export function useInbox() {
  const [queue, setQueue] = useState<Item[] | null>(null)
  const [queueError, setQueueError] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const reports = usePaged<Report>("/api/admin/reports", "items")
  const attention = usePaged<Attention>("/api/admin/attention", "ops")
  const [sel, setSel] = useState<Selection | null>(null)
  const [filter, setFilter] = useState<Filter>("all")
  const [done, setDone] = useState(0)
  const [said, setSaid] = useState<Said | null>(null)

  const { refresh: refreshReports } = reports
  const { refresh: refreshAttention } = attention
  const loadReports = useCallback(async () => {
    await Promise.all([refreshReports(), refreshAttention()])
  }, [refreshReports, refreshAttention])
  const loadQueue = useCallback(async () => {
    const r = await fetchQueue()
    if (typeof r === "string") setQueueError(r)
    else {
      setQueue(r)
      setQueueError("")
    }
  }, [])
  const reload = useCallback(async () => {
    await Promise.all([loadQueue(), loadReports()])
  }, [loadQueue, loadReports])
  useEffect(() => {
    let live = true
    void loadReports()
    void fetchQueue().then((r) => {
      if (!live) return
      if (typeof r === "string") setQueueError(r)
      else setQueue(r)
    })
    return () => {
      live = false
    }
  }, [loadReports])

  const say = useCallback((text: string, tone: Said["tone"] = "done") => setSaid((s) => ({ text, tone, n: (s?.n ?? 0) + 1 })), [])
  useEffect(() => {
    if (!said) return
    const t = setTimeout(() => setSaid(null), said.tone === "error" ? 5200 : 3200)
    return () => clearTimeout(t)
  }, [said])

  const all = useMemo(() => reports.items ?? [], [reports.items])
  const hot = useMemo(() => all.filter(urgent), [all])
  const rest = useMemo(() => all.filter((r) => !urgent(r)), [all])
  const proposals = useMemo(() => queue ?? [], [queue])
  const ops = attention.items ?? []
  const openReports = all.filter((r) => r.status !== "closed").length
  const remaining = openReports + ops.length + proposals.length
  const loaded = reports.items !== null && queue !== null
  const failed = !loaded && (!!queueError || reports.failed === "refresh")

  // The order the list shows and the keys move through: urgent requests, the other requests, then submissions oldest first.
  const order: Selection[] = useMemo(
    () => [
      ...(filter !== "proposals" ? [...hot, ...rest].map((r) => ({ kind: "report" as const, id: r.id })) : []),
      ...(filter !== "reports" ? proposals.map((i) => ({ kind: "proposal" as const, id: i.id })) : []),
    ],
    [filter, hot, rest, proposals],
  )
  const report = sel?.kind === "report" ? all.find((r) => r.id === sel.id) : undefined
  const proposal = sel?.kind === "proposal" ? proposals.find((i) => i.id === sel.id) : undefined
  const shown: Selection | null = report || proposal ? sel : null
  const position = shown ? order.findIndex((s) => same(s, shown)) : -1

  const step = useCallback(
    (by: 1 | -1) => {
      if (!order.length) return null
      const next = order[Math.min(Math.max(position + by, 0), order.length - 1)]
      setSel(next)
      return next
    },
    [order, position],
  )

  const decide = async (item: Item, action: Action, note?: string) => {
    setBusy(item.id)
    const error = await transition(item, action, note)
    const at = proposals.findIndex((i) => i.id === item.id)
    const r = await fetchQueue()
    setBusy(null)
    if (error) say(error, "error")
    if (typeof r === "string") return say(r, "error")
    setQueue(r)
    if (error) return
    setDone((d) => d + 1)
    say(DONE[action])
    // The next one takes its place, so a session reads straight through; after the last, the overview says so.
    const next = r[at] ?? r[at - 1]
    setSel(next ? { kind: "proposal", id: next.id } : null)
  }

  return {
    queue,
    queueError,
    busy,
    reports,
    attention,
    hot,
    rest,
    proposals,
    ops,
    openReports,
    remaining,
    loaded,
    failed,
    order,
    report,
    proposal,
    shown,
    position,
    filter,
    setFilter,
    select: setSel,
    step,
    decide,
    done,
    said,
    say,
    reload,
    loadReports,
  }
}
export type Inbox = ReturnType<typeof useInbox>
