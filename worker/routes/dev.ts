import { Hono } from "hono"
import { SignJWT } from "jose"

/** Development only: stands in for the Access sign-in, so the admin page and e2e tests can log in locally. */
export const dev = new Hono<{ Bindings: Env }>()

dev.post("/login", async (c) => {
  if (c.env.ENVIRONMENT !== "development" || !c.env.DEV_ACCESS_SECRET) return c.notFound()
  const { email } = await c.req.json<{ email: string }>()
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("dev-access")
    .setAudience("makom-dev")
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(new TextEncoder().encode(c.env.DEV_ACCESS_SECRET))
  return c.body(null, 204, { "Set-Cookie": `CF_Authorization=${token}; Path=/; HttpOnly; SameSite=Lax` })
})

/** Development only: the mails the local adapter would have sent to an address, oldest first (dev_outbox). */
dev.get("/mail", async (c) => {
  if (c.env.ENVIRONMENT !== "development") return c.notFound()
  const to = c.req.query("to") ?? ""
  const { results } = await c.env.DB.prepare("SELECT subject, body AS text, at FROM dev_outbox WHERE to_address = ? ORDER BY at, id")
    .bind(to)
    .all()
  return c.json(results, 200, { "Cache-Control": "private, no-store" })
})
