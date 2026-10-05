import type { SubmissionInput } from "@/shared/contract"

/** Null when the server can't be reached: the place is still kept on this device, and the visitor is told so. */
export async function submitPlace(input: SubmissionInput): Promise<{ id: string; trackingToken: string } | null> {
  try {
    const res = await fetch("/api/v1/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      // The save button waits on this; a server that hangs mustn't hold the visitor's place hostage.
      signal: AbortSignal.timeout(8000),
    })
    return res.status === 201 ? await res.json() : null
  } catch {
    return null
  }
}
