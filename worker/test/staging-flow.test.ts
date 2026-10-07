import { createExecutionContext } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { SignJWT } from "jose"
import { expect, it } from "vitest"
import { stagingFlow } from "../../scripts/staging-flow.mjs"
import { createApp } from "../index"
import { sendMail } from "../lib/mail"
import { fakeSiteverify } from "./app"
import { withSite } from "./helpers"

// The milestone script (scripts/staging-flow.mjs, L-FLOW) against the real Worker, so the requests it sends on staging
// are the ones the routes take: the machine moderator signed in as Access would pass it on (here the development
// issuer), the test keys' answer that development and staging accept, every step from submission to removal.
const machine = () =>
  new SignJWT({ common_name: env.MODERATOR_SERVICE_TOKENS.split(",")[0], type: "app" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("dev-access")
    .setAudience("makom-dev")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.DEV_ACCESS_SECRET))
const app = createApp({ verifyTurnstile: fakeSiteverify, sendMail, purge: async () => true })

it("the staging flow passes against the Worker: submitted, queued, approved, published, hidden, removed", async () => {
  const fetch = async (input: string, init?: RequestInit) => app.fetch(new Request(input, init), withSite, createExecutionContext())
  const result = await stagingFlow("http://local", {
    fetch,
    headers: { "Cf-Access-Jwt-Assertion": await machine() },
    turnstileToken: "testing-key",
    timing: { everyMs: 10, deadlineMs: 3_000, requestMs: 3_000 },
  })
  expect(result.outcome, JSON.stringify(result.steps)).toBe("pass")
  expect(result.steps.map((s) => s.step)).toEqual(["submitted", "queued", "approved", "published", "hidden", "removed"])
})
