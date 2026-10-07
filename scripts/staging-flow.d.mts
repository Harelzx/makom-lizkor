export function stagingFlow(
  base: string,
  options: {
    fetch?: (url: string, init?: RequestInit) => Promise<Response>
    headers: Record<string, string> | null
    turnstileToken: string | undefined
    timing?: { everyMs: number; deadlineMs: number; requestMs: number }
  },
): Promise<{
  run: string
  place: string | null
  outcome: "pass" | "fail"
  steps: { step: string; status: "pass" | "fail"; at_ms: number; detail: string }[]
}>
