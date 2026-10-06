import { createExecutionContext } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { SignJWT } from "jose"
import { describe, expect, it } from "vitest"
import { OpsSummary } from "../lib/ops-summary"
import { createApp } from "../index"
import { sendMail } from "../lib/mail"
import { fakeSiteverify } from "./app"
import { approve, devToken } from "./helpers"
import { send } from "./submission-helpers"

// GET /api/ops/summary (spec 10, 12.1; adviser a49): the diagnostic agent's only view of production, aggregates only,
// for an Access service token on the list and nobody else.

const serviceToken = (commonName: string) =>
  new SignJWT({ common_name: commonName, type: "app" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("dev-access")
    .setAudience("makom-dev")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.DEV_ACCESS_SECRET))
const app = (errorRates?: Parameters<typeof createApp>[0]["errorRates"]) =>
  createApp({ verifyTurnstile: fakeSiteverify, sendMail, purge: async () => true, errorRates })
const get = async (token: string | null, a = app()) =>
  a.fetch(
    new Request("http://local/api/ops/summary", token ? { headers: { "Cf-Access-Jwt-Assertion": token } } : {}),
    env,
    createExecutionContext(),
  )
const allowed = () => env.OPS_SERVICE_TOKENS.split(",")[0]

describe("the ops summary", () => {
  it("is refused without a token, to a moderator, and to a service token not on the list", async () => {
    expect((await get(null)).status).toBe(401)
    expect((await get(await devToken("dev@example.test"))).status).toBe(403)
    expect((await get(await serviceToken("not-listed.access"))).status).toBe(403)
  })

  it("gives a listed service token aggregates only, under the schema, never a person's words", async () => {
    // Demo data full of what must never appear: names, emails, stories, a request's text.
    const s = await send("גן דמו ששמו לא יופיע בסיכום", {
      submitter_name: "שולח דמו פרטי",
      email: "ops-private-demo@example.test",
      story_he: "סיפור דמו פרטי שלא יופיע",
    })
    expect((await approve(s.id)).status).toBe(200)
    await send("ספסל דמו ממתין בסיכום")
    const res = await get(await serviceToken(allowed()))
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store")
    const text = await res.text()
    const body = OpsSummary.parse(JSON.parse(text))
    for (const word of ["גן דמו", "שולח דמו", "ops-private-demo", "סיפור דמו", "example.test", s.id]) expect(text).not.toContain(word)
    expect(body.places.published).toBeGreaterThanOrEqual(1)
    expect(body.queue.pending).toBeGreaterThanOrEqual(1)
  })

  it("says error rates are unavailable when no source is connected, never zero", async () => {
    const body = OpsSummary.parse(await (await get(await serviceToken(allowed()))).json())
    expect(body.errors).toEqual({ status: "unavailable" })
  })

  it("reports error rates from a connected source over its window, per thousand requests", async () => {
    const synthetic = async () => ({ windowHours: 24, requests: 20_000, byCode: { rate_limited: 30, unhandled: 2 } })
    const body = OpsSummary.parse(await (await get(await serviceToken(allowed()), app(synthetic))).json())
    expect(body.errors).toEqual({
      status: "ok",
      window_hours: 24,
      requests: 20_000,
      by_code: { rate_limited: 30, unhandled: 2 },
      per_thousand: { rate_limited: 1.5, unhandled: 0.1 },
    })
    // A source that fails is unavailable too.
    const down = async () => {
      throw new Error("down")
    }
    expect(OpsSummary.parse(await (await get(await serviceToken(allowed()), app(down))).json()).errors).toEqual({ status: "unavailable" })
  })
})

it("the summary's schema is the committed one: a change to what the agent sees is reviewed (and flagged in the release manifest)", async () => {
  const { z } = await import("zod")
  const { default: committed } = await import("../lib/ops-summary.schema.json")
  expect(z.toJSONSchema(OpsSummary)).toEqual(committed)
})

// Staging admits only the CI's service token through Access, and its MODERATORS holds a placeholder no one can sign in
// as (adviser a55): the token carries no email, so it is never a moderator, listed for the ops summary or not.
it("a service token is never a moderator: the queue and an approval refuse it, whatever MODERATORS holds", async () => {
  const token = await serviceToken(allowed())
  const call = (path: string, e: Env, init: RequestInit = {}) =>
    app().fetch(
      new Request(`http://local${path}`, {
        ...init,
        headers: { "Cf-Access-Jwt-Assertion": token, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
      }),
      e,
      createExecutionContext(),
    )
  const s = await send("גן דמו שאסימון שירות לא יאשר")
  for (const e of [env, { ...env, MODERATORS: "staging-moderator@example.test" }]) {
    expect((await call("/api/admin/queue", e)).status).toBe(403)
    const approval = await call(`/api/admin/places/${s.id}/transitions`, e, {
      method: "POST",
      body: JSON.stringify({ action: "approve", revisionId: "r", expectedRev: 0 }),
    })
    expect(approval.status).toBe(403)
  }
  // Still waiting for a person: the moderator's own queue has it.
  const queue = await app().fetch(
    new Request("http://local/api/admin/queue", { headers: { "Cf-Access-Jwt-Assertion": await devToken("dev@example.test") } }),
    env,
    createExecutionContext(),
  )
  expect(((await queue.json()) as { items: { id: string }[] }).items.some((i) => i.id === s.id)).toBe(true)
})
