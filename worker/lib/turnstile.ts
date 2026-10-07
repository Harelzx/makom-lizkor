/** What Cloudflare's siteverify answers; only the fields we read. */
export type Siteverify = {
  success: boolean
  hostname?: string
  action?: string
  "error-codes"?: string[]
  metadata?: { result_with_testing_key?: boolean }
}
export type VerifyTurnstile = (secret: string, token: string, remoteip?: string) => Promise<Siteverify>

/** The real check. Throws when Cloudflare can't be reached, which the caller treats as "try again later". */
export const siteverify: VerifyTurnstile = async (secret, token, remoteip) => {
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, response: token, ...(remoteip ? { remoteip } : {}) }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`siteverify ${res.status}`)
  return res.json()
}

export type TurnstileOutcome = "ok" | "required" | "failed" | "unavailable"

/**
 * A browser check passed, for this action, on one of our hostnames (spec 12). Cloudflare's test keys answer without an
 * action and for example.com; that is accepted in development, and on staging, whose submissions are synthetic and
 * whose host Access guards (Harel, H-TURNSTILE), never in production. A staging run with them proves the flow, not the
 * real bot check. A missing secret in production refuses everything rather than letting anything through.
 */
export async function checkTurnstile(
  env: Env,
  verify: VerifyTurnstile,
  token: string | undefined,
  action: string,
  remoteip?: string,
): Promise<TurnstileOutcome> {
  if (!env.TURNSTILE_SECRET) return "unavailable"
  if (!token || token.length > 2048) return "required"
  let r: Siteverify
  try {
    r = await verify(env.TURNSTILE_SECRET, token, remoteip)
  } catch {
    return "unavailable"
  }
  const hostnames = new Set(
    (env.TURNSTILE_HOSTNAMES ?? "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
  )
  const testing = (env.ENVIRONMENT === "development" || env.ENVIRONMENT === "staging") && r.metadata?.result_with_testing_key === true
  if (!r.success || !r.hostname || !hostnames.has(r.hostname)) return "failed"
  if (r.action !== action && !testing) return "failed"
  return "ok"
}
