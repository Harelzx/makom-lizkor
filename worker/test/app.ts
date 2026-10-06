import { createExecutionContext } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { createApp } from "../index"
import { sendMail } from "../lib/mail"
import type { Siteverify } from "../lib/turnstile"

/**
 * Stands in for Cloudflare's siteverify, so the tests need no network. The token names the answer:
 * "pass" a real success for the submit action, "testing-key" what Cloudflare's test keys return (no action),
 * "wrong-action" and "wrong-host" successes that don't match, "fail" a failure, "down" an unreachable service.
 */
export async function fakeSiteverify(_secret: string, token: string): Promise<Siteverify> {
  if (token === "down") throw new Error("unreachable")
  if (token === "fail") return { success: false, "error-codes": ["invalid-input-response"] }
  if (token === "testing-key") return { success: true, hostname: "example.com", metadata: { result_with_testing_key: true } }
  if (token === "wrong-host") return { success: true, hostname: "evil.test", action: "submit" }
  if (token === "wrong-action") return { success: true, hostname: "example.com", action: "login" }
  if (token === "pass-revise") return { success: true, hostname: "example.com", action: "revise" }
  return { success: token === "pass", hostname: "example.com", action: "submit" }
}

/** Every purge the Worker asked for, in order; `purgeFails` makes the edge refuse them. */
export const purges: string[][] = []
export const edge = { purgeFails: false }

// Mail goes to dev_outbox, as in development, so the tests read what would be sent.
const app = createApp({
  verifyTurnstile: fakeSiteverify,
  sendMail,
  purge: async (_env, _ctx, tags) => (purges.push(tags), !edge.purgeFails),
})

/** The Worker as the tests see it: real routes and bindings, the fake siteverify. */
export const call = (url: string, init: RequestInit = {}, e: Env = env) => app.fetch(new Request(url, init), e, createExecutionContext())
