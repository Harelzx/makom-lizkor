import { Hono } from "hono"
import { SignJWT } from "jose"
import type { AppEnv } from "../index"
import { runJobs } from "../jobs"
import { clock } from "../lib/clock"
import { OG_TEMPLATE_VERSION, renderOg, type OgProjection } from "../lib/og"

/** Development only: stands in for the Access sign-in, so the admin page and e2e tests can log in locally. */
export const dev = new Hono<AppEnv>()

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

/** Development only: runs the scheduled jobs now, at the X-Test-Now clock, as the cron does every 15 minutes. */
dev.post("/cron", async (c) => {
  if (c.env.ENVIRONMENT !== "development") return c.notFound()
  await runJobs(c.env, { sendMail: c.get("sendMail"), purge: c.get("purge") }, c.executionCtx, clock(c.req.raw, c.env))
  return c.json({ ok: true }, 200, { "Cache-Control": "private, no-store" })
})

// The share image's visual fixtures (L4): Hebrew alone, mixed with Latin, digits and parentheses, long names and
// settlements, text that must be escaped, each with and without a photo.
const OG_FIXTURES: [string, string][] = [
  ["גן הזיכרון לנרצחי המסיבה", "רעים"],
  ["ספסל לזכר דניאל (Danny) 1998–2023", "כפר עזה"],
  ["חורשת הזיכרון לחברי כיתת הכוננות של קיבוץ ניר עוז שנפלו בהגנה על הבית ועל המשפחות", "מועצה אזורית אשכול, ליד שער הקיבוץ הצפוני"],
  ["<script>alert(\"x\")</script> & גן 'אבן'", "נחל עוז"],
  ["Memorial Garden 7.10", ""],
]

/** Development only: one fixture drawn as the share image, with an approved photo from the local bucket if named. */
dev.get("/og-preview", async (c) => {
  if (c.env.ENVIRONMENT !== "development") return c.notFound()
  const [name_he, place_he] = OG_FIXTURES[Number(c.req.query("i") ?? 0)] ?? OG_FIXTURES[0]
  const key = c.req.query("photo")
  const photo = key?.startsWith("public/") ? await c.env.MEDIA.get(key) : null
  const p: OgProjection = { v: OG_TEMPLATE_VERSION, kind: "garden", name_he, place_he, photo: photo ? key! : null }
  const t0 = performance.now()
  const png = await renderOg(p, photo ? new Uint8Array(await photo.arrayBuffer()) : null)
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "Server-Timing": `render;dur=${(performance.now() - t0).toFixed(1)}`,
    },
  })
})

/** Development only: every fixture on one page, with and without the photo. */
dev.get("/og-sheet", (c) => {
  if (c.env.ENVIRONMENT !== "development") return c.notFound()
  const photo = c.req.query("photo") ?? ""
  const imgs = OG_FIXTURES.flatMap((_, i) => [
    `<img src="/__dev/og-preview?i=${i}" width="760">`,
    photo ? `<img src="/__dev/og-preview?i=${i}&photo=${encodeURIComponent(photo)}" width="760">` : "",
  ]).join("")
  return c.html(`<!doctype html><body style="margin:0;background:#888;display:grid;grid-template-columns:760px;gap:8px">${imgs}</body>`)
})
