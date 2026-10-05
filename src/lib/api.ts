import type { SubmissionInput } from "@/shared/contract"

export type SendResult =
  { ok: true; id: string; trackingToken: string } | { ok: false; kind: "rejected"; code: string } | { ok: false; kind: "temporary" }

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
    const res = await fetch("/api/v1/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 201 || res.status === 200) return { ok: true, ...((await res.json()) as { id: string; trackingToken: string }) }
    if (REJECTED.has(res.status)) {
      const code = ((await res.json().catch(() => ({}))) as { code?: string }).code ?? `http_${res.status}`
      return { ok: false, kind: "rejected", code }
    }
    return { ok: false, kind: "temporary" }
  } catch {
    return { ok: false, kind: "temporary" }
  }
}

export type Tracked = { status: string; name_he: string | null }

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
