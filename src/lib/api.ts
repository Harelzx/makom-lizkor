import { turnstileToken } from "@/lib/turnstile"
import type { RevisionInput, SubmissionInput, TributeResult, TributeTotals } from "@/shared/contract"

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
    return { ok: false, kind: "temporary", code, retryAfter: Number(res.headers.get("Retry-After")) || undefined }
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
  draft?: Draft
}

/** The status the server holds for a submission; null when the link is wrong, undefined when the server can't be reached. */
export async function trackSubmission(id: string, token: string): Promise<Tracked | null | undefined> {
  try {
    const res = await fetch(`/api/v1/submissions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 404) return null
    return res.ok ? ((await res.json()) as Tracked) : undefined
  } catch {
    return undefined
  }
}

/** True once the server has erased it; false when it couldn't be done now (the visitor may try again). */
export async function withdrawSubmission(id: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/v1/submissions/${encodeURIComponent(id)}/withdraw`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** "ok", "conflict" when the place changed since the sender looked (reload and try again), or "failed". */
export async function reviseSubmission(
  id: string,
  token: string,
  body: RevisionInput,
): Promise<"ok" | "conflict" | "queue_full" | "failed"> {
  try {
    const check = await turnstileToken("revise")
    const res = await fetch(`/api/v1/submissions/${encodeURIComponent(id)}/revisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(check ? { "Turnstile-Token": check } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) return "ok"
    if (res.status === 409) return "conflict"
    const code = ((await res.json().catch(() => ({}))) as { code?: string }).code
    return code === "queue_full" ? "queue_full" : "failed"
  } catch {
    return "failed"
  }
}

/** "ok", "expired" when the link is wrong or older than its seven days, or "failed" when the server can't be reached. */
export async function confirmEmail(token: string): Promise<"ok" | "again" | "expired" | "failed"> {
  try {
    const res = await fetch("/api/v1/email/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) return ((await res.json()) as { first?: boolean }).first === false ? "again" : "ok"
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
