import { createRemoteJWKSet, jwtVerify } from "jose"

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function readToken(req: Request): string | null {
  const header = req.headers.get("Cf-Access-Jwt-Assertion")
  if (header) return header
  return /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(req.headers.get("Cookie") ?? "")?.[1] ?? null
}

/** The audit trail's actor for staging's synthetic machine moderator: never a person, and never shown as one. */
export const MACHINE_ACTOR = "machine:staging-synthetic"

/**
 * Whether an Access service token (its client id, `common_name`) moderates here: only staging's synthetic machine
 * moderator (Harel's approval H1, 7 October 2026), and only in staging, or locally in development (never deployed).
 * Production refuses it whatever MODERATOR_SERVICE_TOKENS holds; a token on OPS_SERVICE_TOKENS never moderates, so the
 * read-only diagnostics can't gain a moderator's powers; any other token (the deployment's own) is refused as before.
 * What it may then do is narrower than a person's: worker/lib/synthetic.ts.
 */
export function machineModerator(id: string, env: Env): boolean {
  if (env.ENVIRONMENT !== "staging" && env.ENVIRONMENT !== "development") return false
  const list = (s: string | undefined) =>
    (s ?? "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean)
  return !!id && list(env.MODERATOR_SERVICE_TOKENS).includes(id) && !list(env.OPS_SERVICE_TOKENS).includes(id)
}

/**
 * In production, Cloudflare Access signs in at the edge and passes a JWT; we verify it again here, so a route
 * that somehow skipped Access still gets nothing. In development, a dev-only issuer stands in for Access.
 */
export async function moderator(
  req: Request,
  env: Env,
): Promise<{ ok: true; email: string; machine: boolean } | { ok: false; status: 401 | 403 }> {
  const token = readToken(req)
  if (!token) return { ok: false, status: 401 }
  const dev = env.ENVIRONMENT === "development" && env.DEV_ACCESS_SECRET
  // Without an Access team and audience there is nothing to verify against: refuse rather than guess.
  if (!dev && (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD)) return { ok: false, status: 401 }
  try {
    const { payload } = await verify(token, env, !!dev)
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : ""
    if (!email) {
      // A service token: a moderator only as the synthetic machine moderator, never by its id alone elsewhere.
      const id = typeof payload.common_name === "string" ? payload.common_name : ""
      return machineModerator(id, env) ? { ok: true, email: MACHINE_ACTOR, machine: true } : { ok: false, status: 403 }
    }
    const allowed = env.MODERATORS.split(",").map((e) => e.trim().toLowerCase())
    return allowed.includes(email) ? { ok: true, email, machine: false } : { ok: false, status: 403 }
  } catch {
    return { ok: false, status: 401 }
  }
}

/**
 * The diagnostic agent (spec 12.1): an Access service token, verified as a moderator's sign-in is, whose client id
 * (`common_name`) is on OPS_SERVICE_TOKENS. A person's sign-in is refused here: moderators have their own pages.
 */
export async function opsCaller(req: Request, env: Env): Promise<{ ok: true } | { ok: false; status: 401 | 403 }> {
  const token = readToken(req)
  if (!token) return { ok: false, status: 401 }
  const dev = env.ENVIRONMENT === "development" && env.DEV_ACCESS_SECRET
  if (!dev && (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD)) return { ok: false, status: 401 }
  try {
    const { payload } = await verify(token, env, !!dev)
    const id = typeof payload.common_name === "string" && typeof payload.email !== "string" ? payload.common_name : ""
    const allowed = (env.OPS_SERVICE_TOKENS ?? "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean)
    return id && allowed.includes(id) ? { ok: true } : { ok: false, status: 403 }
  } catch {
    return { ok: false, status: 401 }
  }
}

/**
 * The purge probe's own caller (L-PURGE, a73): an Access service token whose client id is on PROBE_SERVICE_TOKENS and on
 * neither the ops list nor the machine moderators', so read-only diagnostics never gain write access by being listed
 * here as well, and no token holds two powers. It may move the probe on and nothing else.
 */
export async function probeCaller(req: Request, env: Env): Promise<{ ok: true } | { ok: false; status: 401 | 403 }> {
  const token = readToken(req)
  if (!token) return { ok: false, status: 401 }
  const dev = env.ENVIRONMENT === "development" && env.DEV_ACCESS_SECRET
  if (!dev && (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD)) return { ok: false, status: 401 }
  try {
    const { payload } = await verify(token, env, !!dev)
    const id = typeof payload.common_name === "string" && typeof payload.email !== "string" ? payload.common_name : ""
    const listed = (names: string | undefined) =>
      (names ?? "")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean)
        .includes(id)
    const own = listed(env.PROBE_SERVICE_TOKENS) && !listed(env.OPS_SERVICE_TOKENS) && !listed(env.MODERATOR_SERVICE_TOKENS)
    return id && own ? { ok: true } : { ok: false, status: 403 }
  } catch {
    return { ok: false, status: 401 }
  }
}

const verify = (token: string, env: Env, dev: boolean) =>
  dev
    ? jwtVerify(token, new TextEncoder().encode(env.DEV_ACCESS_SECRET), { issuer: "dev-access", audience: "makom-dev" })
    : jwtVerify(token, keysFor(env.ACCESS_TEAM_DOMAIN), {
        issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
        audience: env.ACCESS_AUD,
        algorithms: ["RS256"],
      })

function keysFor(team: string) {
  let k = jwks.get(team)
  if (!k) jwks.set(team, (k = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`))))
  return k
}
