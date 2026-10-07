import { env } from "cloudflare:workers"
import { createExecutionContext } from "cloudflare:test"
import { describe, expect, it } from "vitest"
import { createApp } from "../index"
import { fakeSiteverify } from "./app"
import { sendMail } from "../lib/mail"
import { devToken } from "./helpers"
import { machineModerator } from "../lib/access"

// What a deploy gets: the top-level vars of wrangler.jsonc, without the development values from .dev.vars.
const production = { ...env, ENVIRONMENT: "production", DEV_ACCESS_SECRET: "", MODERATORS: "", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" }
const app = createApp({ verifyTurnstile: fakeSiteverify, sendMail, purge: async () => true })
const call = (path: string, init: RequestInit = {}, e: Env = production) =>
  app.fetch(new Request(`http://local${path}`, init), e, createExecutionContext())

describe("in production", () => {
  it("the dev login doesn't exist", async () => {
    const res = await call("/__dev/login", { method: "POST", body: JSON.stringify({ email: "dev@example.test" }) })
    expect(res.status).toBe(404)
  })
  it("a token from the dev issuer opens nothing, even for a listed moderator", async () => {
    const e = { ...production, DEV_ACCESS_SECRET: env.DEV_ACCESS_SECRET, MODERATORS: "dev@example.test" }
    const res = await call("/api/admin/queue", { headers: { "Cf-Access-Jwt-Assertion": await devToken("dev@example.test") } }, e)
    expect(res.status).toBe(401)
  })
  it("a machine moderator's token moderates nothing, even when the config lists it (H1)", () => {
    expect(
      machineModerator("dev-staging-moderator.access", { ...production, MODERATOR_SERVICE_TOKENS: "dev-staging-moderator.access" }),
    ).toBe(false)
  })
  it("the clock can't be set from outside", async () => {
    const res = await call("/api/v1/submissions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
        "Turnstile-Token": "pass",
        "X-Test-Now": "2000-01-01T00:00:00Z",
      },
      body: JSON.stringify({ kind: "bench", name_he: "ספסל דמו", lat: 31.42, lng: 34.49, consent_version: "notice.submission@2026-10-2" }),
    })
    const { id } = await res.json<{ id: string }>()
    const created = await env.DB.prepare("SELECT created_at FROM places WHERE id = ?").bind(id).first<string>("created_at")
    expect(created!.startsWith("2000")).toBe(false)
  })
})

it("the config a deploy ships is production, with no development secret", () => {
  expect(env.DEPLOY_VARS.ENVIRONMENT).toBe("production")
  expect(env.DEPLOY_VARS.DEV_ACCESS_SECRET).toBeUndefined()
  expect(env.DEPLOY_VARS.MODERATORS ?? "").not.toContain("example.test")
  // Staging's synthetic machine moderator never ships (H1).
  expect(env.DEPLOY_VARS.MODERATOR_SERVICE_TOKENS ?? "").toBe("")
  // Locally, .dev.vars (never deployed) turns development on; the tests run with it.
  expect(env.ENVIRONMENT).toBe("development")
})
