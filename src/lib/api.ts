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
