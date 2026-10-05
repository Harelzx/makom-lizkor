import { createRemoteJWKSet, jwtVerify } from "jose"

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function readToken(req: Request): string | null {
  const header = req.headers.get("Cf-Access-Jwt-Assertion")
  if (header) return header
  return /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(req.headers.get("Cookie") ?? "")?.[1] ?? null
}

/**
 * In production, Cloudflare Access signs in at the edge and passes a JWT; we verify it again here, so a route
 * that somehow skipped Access still gets nothing. In development, a dev-only issuer stands in for Access.
 */
export async function moderator(req: Request, env: Env): Promise<{ ok: true; email: string } | { ok: false; status: 401 | 403 }> {
  const token = readToken(req)
  if (!token) return { ok: false, status: 401 }
  const dev = env.ENVIRONMENT === "development" && env.DEV_ACCESS_SECRET
  // Without an Access team and audience there is nothing to verify against: refuse rather than guess.
  if (!dev && (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD)) return { ok: false, status: 401 }
  try {
    const { payload } = dev
      ? await jwtVerify(token, new TextEncoder().encode(env.DEV_ACCESS_SECRET), { issuer: "dev-access", audience: "makom-dev" })
      : await jwtVerify(token, keysFor(env.ACCESS_TEAM_DOMAIN), {
          issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
          audience: env.ACCESS_AUD,
          algorithms: ["RS256"],
        })
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : ""
    const allowed = env.MODERATORS.split(",").map((e) => e.trim().toLowerCase())
    return email && allowed.includes(email) ? { ok: true, email } : { ok: false, status: 403 }
  } catch {
    return { ok: false, status: 401 }
  }
}

function keysFor(team: string) {
  let k = jwks.get(team)
  if (!k) jwks.set(team, (k = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`))))
  return k
}
