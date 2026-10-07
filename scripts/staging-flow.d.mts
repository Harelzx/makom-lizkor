export function stagingFlow(
  base: string,
  options: {
    fetch?: (url: string, init?: RequestInit) => Promise<Response>
    headers: Record<string, string> | null
    turnstileToken: string | undefined
    timing?: { everyMs: number; deadlineMs: number; requestMs: number }
    expectTag?: string | null
  },
): Promise<{
  run: string
  place: string | null
  outcome: "pass" | "fail"
  expect_tag: string | null
  versions: string[]
  version_failure?: string
  steps: { step: string; status: "pass" | "fail"; at_ms: number; detail: string }[]
}>

export function runCli(
  args: string[],
  options?: {
    env?: Record<string, string | undefined>
    fetch?: (url: string, init?: RequestInit) => Promise<Response>
    log?: (line: string) => void
    timing?: { everyMs: number; deadlineMs: number; requestMs: number }
  },
): Promise<number>
