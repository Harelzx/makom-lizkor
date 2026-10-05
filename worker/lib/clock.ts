/** The server's only clock. Tests may set it with X-Test-Now, and only in development. */
export function clock(req: Request, env: Env): Date {
  const forced = env.ENVIRONMENT === "development" ? req.headers.get("X-Test-Now") : null
  const d = forced ? new Date(forced) : new Date()
  return Number.isNaN(d.getTime()) ? new Date() : d
}
