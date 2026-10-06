import { turnstileToken } from "@/lib/turnstile"
import { ReportResult } from "@/shared/contract"
import type { ReportInput, RevisionInput, SubmissionInput, TributeResult, TributeTotals } from "@/shared/contract"

export type SendResult =
  | { ok: true; id: string; trackingToken: string }
  | { ok: false; kind: "rejected"; code: string }
  /** `retryAfter` (seconds) when the server said when to come back: a full queue, a busy check, too many at once. */
  | { ok: false; kind: "temporary"; code?: string; retryAfter?: number }

/** One key per place, made before the first try and kept with the place, so every retry is the same submission. */
export function newSubmitKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

const REJECTED = new Set([400, 409, 413, 415, 422])
const CHECK_RETRY_S = 600

/** The server either took the place, refused it (don't send it again), or couldn't be reached (send it again later). */
export async function submitPlace(input: SubmissionInput, key: string): Promise<SendResult> {
  try {
    const token = await turnstileToken("submit")
    const res = await fetch("/api/v1/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key, ...(token ? { "Turnstile-Token": token } : {}) },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 201 || res.status === 200) return { ok: true, ...((await res.json()) as { id: string; trackingToken: string }) }
    if (REJECTED.has(res.status)) {
      const code = ((await res.json().catch(() => ({}))) as { code?: string }).code ?? `http_${res.status}`
      return { ok: false, kind: "rejected", code }
    }
    const code = ((await res.json().catch(() => ({}))) as { code?: string }).code
    // A token the server judged and refused isn't mended by the next wake: it waits ten minutes, so the visitor isn't
    // shown a challenge every 30 seconds. No token at all (the check couldn't run in this browser just now) is retried
    // at the next wake like any temporary failure. The server's own wait, when it gives one, wins.
    const wait = Number(res.headers.get("Retry-After")) || (code === "turnstile_failed" ? CHECK_RETRY_S : undefined)
    return { ok: false, kind: "temporary", code, retryAfter: wait }
  } catch {
    return { ok: false, kind: "temporary" }
  }
}

export type Draft = {
  name_he: string
  place_he: string | null
  in_memory_of: string | null
  story_he: string | null
  link_url: string | null
}
export type Tracked = {
  status: string
  rev?: number
  name_he: string | null
  /** The newest revision's state: a correction may be pending, returned or refused while the place stays published. */
  revision_state?: string
  /** The moderator's note, when the newest revision was returned for a change. */
  note?: string
  /** "pending" when the submission was withdrawn but some of its files are still to be erased (they are not shown). */
  files?: string
  draft?: Draft
}

/** The status the server holds for a submission; null when the link is wrong, undefined when the server can't be reached. */
/** The statuses the API reports to a sender (worker/db/places.ts), and nothing else. */
const STATUSES = new Set(["pending", "returned", "published", "rejected", "hidden", "withdrawn", "erased"])
/** A revision's states, as the database allows them (migrations/0001_places.sql). */
const REVISION_STATES = new Set(["pending", "returned", "approved", "rejected", "superseded", "withdrawn"])
const optional = (v: unknown, type: string) => v === undefined || typeof v === type
const text = (v: unknown) => v === null || v === undefined || typeof v === "string"
/**
 * Whether an answer has the shape the API sends: a known status, its revision number, and the fields that decide
 * completion, recovery and a correction's fate (files, only ever "pending"; a known revision state) in their own
 * types. Anything else is read as no answer.
 */
function isTracked(b: unknown): b is Tracked {
  if (!b || typeof b !== "object") return false
  const t = b as Record<string, unknown>
  const draft = t.draft as Record<string, unknown> | undefined
  return (
    typeof t.status === "string" &&
    STATUSES.has(t.status) &&
    text(t.name_he) &&
    Number.isInteger(t.rev) &&
    (t.rev as number) >= 1 &&
    (t.revision_state === undefined || (typeof t.revision_state === "string" && REVISION_STATES.has(t.revision_state))) &&
    optional(t.note, "string") &&
    (t.files === undefined || t.files === "pending") &&
    (draft === undefined ||
      (typeof draft === "object" &&
        draft !== null &&
        typeof draft.name_he === "string" &&
        ["place_he", "in_memory_of", "story_he", "link_url"].every((k) => text(draft[k]))))
  )
}

export async function trackSubmission(id: string, token: string): Promise<Tracked | null | undefined> {
  try {
    const res = await fetch(`/api/v1/submissions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    })
    // Only the API's own answer means the link opens nothing (the device then lets its copy of the link go); a 404 from
    // anywhere else is a failure to read, not proof.
    if (res.status === 404)
      return ((await res.json().catch(() => null)) as { code?: string } | null)?.code === "not_found" ? null : undefined
    if (!res.ok) return undefined
    // A status, or nothing known: null is kept for the API's own "not found" above, since it lets the device's link go.
    const body = (await res.json().catch(() => null)) as unknown
    return isTracked(body) ? body : undefined
  } catch {
    return undefined
  }
}

/** True once the server has erased it; false when it couldn't be done now (the visitor may try again). */
/**
 * "withdrawn" once the server has erased it; "files_pending" when it was withdrawn but its files are still to go (they
 * are no longer served); "failed" when the server said no or couldn't be reached: the caller checks the status, since a
 * withdrawal whose answer was lost may have happened.
 */
export async function withdrawSubmission(id: string, token: string): Promise<"withdrawn" | "files_pending" | "failed"> {
  try {
    const res = await fetch(`/api/v1/submissions/${encodeURIComponent(id)}/withdraw`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return "failed"
    // Only the answer the API gives establishes a withdrawal: withdrawn, with its files erased or still pending.
    // Anything else (unreadable, empty, another status) establishes nothing, and the link is kept to try again.
    const body = (await res.json().catch(() => null)) as { status?: unknown; files?: unknown } | null
    if (body?.status !== "withdrawn") return "failed"
    if (body.files === undefined) return "withdrawn"
    return body.files === "pending" ? "files_pending" : "failed"
  } catch {
    return "failed"
  }
}

/**
 * "ok"; "conflict" when the place changed since the sender looked; "queue_full"; "refused" when the server didn't accept
 * it (invalid); "gone" when the link no longer opens the submission; "failed" when it was turned away before anything was saved (the check failed, too many at once);
 * "uncertain" when no answer came or the server failed midway, so the correction may have been saved.
 */
export async function reviseSubmission(
  id: string,
  token: string,
  body: RevisionInput,
): Promise<"ok" | "conflict" | "queue_full" | "refused" | "gone" | "failed" | "uncertain"> {
  // No check token: nothing was sent, so nothing was saved.
  const check = await turnstileToken("revise").catch(() => undefined)
  if (check === undefined) return "failed"
  let res: Response
  try {
    res = await fetch(`/api/v1/submissions/${encodeURIComponent(id)}/revisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(check ? { "Turnstile-Token": check } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return "uncertain"
  }
  if (res.ok) return "ok"
  if (res.status === 409) return "conflict"
  const code = ((await res.json().catch(() => ({}))) as { code?: string }).code
  if (code === "queue_full") return "queue_full"
  if (res.status === 404) return "gone"
  if (res.status === 400) return "refused"
  if (res.status === 403 || res.status === 429 || code === "turnstile_unavailable") return "failed"
  return "uncertain"
}

/** "ok", "expired" when the link is wrong or older than its seven days, or "failed" when the server can't be reached. */
/**
 * ok: verified now and the tracking link sent · resent: verified before, the link sent now · again: verified and sent
 * before · unsent: verified, but the link didn't go this time (a later click tries again) · stopped: it won't be tried
 * again · expired · failed: no answer.
 */
export type Confirmed = "ok" | "resent" | "again" | "unsent" | "stopped" | "expired" | "failed"
export async function confirmEmail(token: string): Promise<Confirmed> {
  try {
    const res = await fetch("/api/v1/email/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      const { first, mail } = (await res.json()) as { first?: boolean; mail?: string }
      if (mail === "failed") return "unsent"
      if (mail === "stopped") return "stopped"
      if (mail === "sent") return first ? "ok" : "resent"
      return "again"
    }
    return res.status === 404 ? "expired" : "failed"
  } catch {
    return "failed"
  }
}

/**
 * The photo of a place already sent, in a second request (the submission's retry stays exact). "rejected" when the
 * server won't take it (not a picture, too large), so it isn't sent again; "temporary" otherwise.
 */
export async function uploadPhoto(
  id: string,
  token: string,
  dataUrl: string,
  alt: string,
  credit?: string,
): Promise<"ok" | "rejected" | "temporary"> {
  try {
    const form = new FormData()
    form.append("photo", await (await fetch(dataUrl)).blob(), "photo.jpg")
    form.append("alt", alt)
    if (credit) form.append("credit", credit)
    const res = await fetch(`/api/v1/submissions/${encodeURIComponent(id)}/photo`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    })
    // A 404: the place is gone or the token no longer opens it; sending again can't help.
    return res.ok ? "ok" : REJECTED.has(res.status) || res.status === 404 ? "rejected" : "temporary"
  } catch {
    return "temporary"
  }
}

/** One anemone for the shared count: the server's answer, refused (don't send it again), or unreachable (later). */
export async function sendTribute(
  placeId: string,
  deviceId: string,
  key: string,
): Promise<{ ok: true; result: TributeResult } | { ok: false; kind: "rejected" | "temporary" }> {
  try {
    const res = await fetch("/api/v1/tributes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ placeId, deviceId }),
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) return { ok: true, result: (await res.json()) as TributeResult }
    return { ok: false, kind: REJECTED.has(res.status) ? "rejected" : "temporary" }
  } catch {
    return { ok: false, kind: "temporary" }
  }
}

/** The shared counts; null when the server can't be reached (the card then shows only this visitor's own flowers). */
export async function getTributeTotals(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch("/api/v1/tributes", { cache: "no-store", signal: AbortSignal.timeout(8000) })
    return res.ok ? ((await res.json()) as TributeTotals).totals : null
  } catch {
    return null
  }
}

export type ReportSend =
  | ({ ok: true } & ReportResult)
  /** Refused before the server stored anything, for this try only: an earlier try's fate is not known from it. */
  | { ok: false; kind: "not_sent"; code: string }
  /** The key already holds a different request on the server: this one's delivery is not confirmed. */
  | { ok: false; kind: "conflict" }
  /** No answer that says: the server may have stored it (a lost answer, an error after the write). */
  | { ok: false; kind: "unknown" }
  /** Not sent: its window ended while this try was being prepared (the bot check can take a while). */
  | { ok: false; kind: "expired" }

/**
 * The refusals the request route gives before it stores anything (worker/routes/reports.ts): the limiter, the body and
 * key checks, configuration, the bot check, and an unknown place. Any other answer may come after the write.
 */
const BEFORE_WRITE: Record<number, string[]> = {
  400: ["invalid_input"],
  403: ["turnstile_required", "turnstile_failed"],
  404: ["not_found"],
  429: ["rate_limited"],
  503: ["not_configured", "turnstile_unavailable"],
}

/**
 * A removal or correction request (spec 6), under the key its first try was given; a fresh bot check every try. Never
 * sent at or after `deadline`, checked at the last moment before it goes.
 */
export async function sendReport(input: ReportInput, key: string, deadline = Infinity): Promise<ReportSend> {
  const token = await turnstileToken("report").catch(() => null)
  if (Date.now() >= deadline) return { ok: false, kind: "expired" }
  let res: Response
  try {
    res = await fetch("/api/v1/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key, ...(token ? { "Turnstile-Token": token } : {}) },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return { ok: false, kind: "unknown" }
  }
  // Any body at all may come back (a proxy's page, JSON null, an array): only a recognised answer is read as one.
  const body: unknown = await res.json().catch(() => null)
  if (res.status === 202) {
    const result = ReportResult.safeParse(body)
    return result.success ? { ok: true, ...result.data } : { ok: false, kind: "unknown" }
  }
  const code = body && typeof body === "object" && "code" in body && typeof body.code === "string" ? body.code : undefined
  if (res.status === 409 && code === "idempotency_key_reused") return { ok: false, kind: "conflict" }
  if (code && BEFORE_WRITE[res.status]?.includes(code)) return { ok: false, kind: "not_sent", code }
  return { ok: false, kind: "unknown" }
}
