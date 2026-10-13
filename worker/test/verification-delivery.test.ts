import { env } from "cloudflare:workers"
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test"
import { expect, it, vi } from "vitest"
import { createApp } from "../index"
import { fakeSiteverify } from "./app"
import { CURRENT_SUBMISSION_NOTICE } from "@/shared/contract"
import { deliverVerification } from "../db/verification-delivery"
import { hmacHex } from "../db/places"
import { sha256Hex } from "../lib/ids"
import type { MailOutcome } from "../lib/gmail"
import { filterForImport } from "../db/import"
import { REAL } from "../lib/durations"

const post = async (attempt: () => Promise<MailOutcome>, key = crypto.randomUUID(), e: Env = env) => {
  const ctx = createExecutionContext()
  const app = createApp({ verifyTurnstile: fakeSiteverify, sendMail: async () => true, mailAttempt: attempt, purge: async () => true })
  const response = await app.fetch(
    new Request("https://project.test/api/v1/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key, "Turnstile-Token": "pass" },
      body: JSON.stringify({
        kind: "bench",
        name_he: "דמו מסירת אימות",
        lat: 31.42,
        lng: 34.49,
        email: "fixture@example.test",
        consent_version: CURRENT_SUBMISSION_NOTICE,
      }),
    }),
    e,
    ctx,
  )
  return { response, ctx, key }
}
const state = (id: string) =>
  env.DB.prepare(
    "SELECT id, verify_mail_state AS state, verify_mail_attempts AS attempts, email_verify_hash AS hash FROM contacts WHERE place_id = ?",
  )
    .bind(id)
    .first<{ id: string; state: string; attempts: number; hash: string }>()

it("filters an older backup without inventing columns absent from its exact-schema recovery target", () => {
  const old = {
    id: "c_old",
    place_id: "p_old",
    email: "fixture@example.test",
    email_verified_at: null,
    email_verify_hash: "old-hash",
    email_verify_expires: "2026-10-10T00:00:00Z",
    purge_after: "2027-01-01T00:00:00Z",
  }
  const filtered = filterForImport({ contacts: [old] }, new Date("2026-10-13T00:00:00Z"), REAL)
  expect(filtered.contacts[0]).toEqual({ ...old, email: null, email_verify_hash: null })
  expect(filtered.contacts[0]).not.toHaveProperty("verify_mail_state")
})

it("production commits its receipt before a slow provider finishes, and concurrent deliveries claim once", async () => {
  let finish!: (value: MailOutcome) => void
  let started!: () => void
  const sending = new Promise<void>((resolve) => {
    started = resolve
  })
  const attempt = vi.fn(
    () =>
      new Promise<MailOutcome>((resolve) => {
        finish = resolve
        started()
      }),
  )
  const e = { ...env, ENVIRONMENT: "production", PUBLIC_ORIGIN: "https://project.test" }
  const { response, ctx, key } = await post(attempt, undefined, e)
  expect(response.status).toBe(201)
  const { id } = await response.json<{ id: string }>()
  // The pending provider cannot hold up the receipt. Its state/hash are already durable.
  await sending
  expect((await state(id))!.state).toBe("sending")
  const r = await post(attempt, key, e)
  expect(r.response.status).toBe(200)
  finish("accepted")
  await Promise.all([waitOnExecutionContext(ctx), waitOnExecutionContext(r.ctx)])
  expect(attempt).toHaveBeenCalledTimes(1)
  expect((await state(id))!.state).toBe("accepted")
  const row = (await state(id))!
  expect(row.hash).toBe(await sha256Hex(await hmacHex(env.TRACKING_SECRET, `verify:${row.id}`)))
})

it("a safe failure retries with a bounded gap, while uncertain acceptance and expiry never resend", async () => {
  const attempt = vi.fn(async (): Promise<MailOutcome> => "retryable")
  const { response } = await post(attempt)
  const { id } = await response.json<{ id: string }>()
  const now = new Date()
  await deliverVerification(env, attempt, now, id)
  expect(attempt).toHaveBeenCalledTimes(1)
  await deliverVerification(env, attempt, new Date(now.getTime() + 16 * 60_000), id)
  expect(attempt).toHaveBeenCalledTimes(2)
  attempt.mockResolvedValue("uncertain")
  await deliverVerification(env, attempt, new Date(now.getTime() + 32 * 60_000), id)
  await deliverVerification(env, attempt, new Date(now.getTime() + 64 * 60_000), id)
  expect(attempt).toHaveBeenCalledTimes(3)
  expect((await state(id))!.state).toBe("uncertain")
  const old = await post(attempt)
  const b = await old.response.json<{ id: string }>()
  await env.DB.prepare("UPDATE contacts SET verify_mail_state = 'retry' WHERE place_id = ?").bind(b.id).run()
  const before = attempt.mock.calls.length
  await deliverVerification(env, attempt, new Date(now.getTime() + 8 * 86400_000), b.id)
  expect(attempt).toHaveBeenCalledTimes(before)
})

it("stops after five safe failures, stops at deletion, and a restore cannot replay a pre-backup send", async () => {
  const attempt = vi.fn(async (): Promise<MailOutcome> => "retryable")
  const { response } = await post(attempt)
  const { id } = await response.json<{ id: string }>()
  const now = new Date()
  for (let i = 1; i <= 6; i++) await deliverVerification(env, attempt, new Date(now.getTime() + i * 16 * 60_000), id)
  expect(attempt).toHaveBeenCalledTimes(5)
  expect((await state(id))!.state).toBe("stopped")
  await env.DB.prepare("DELETE FROM contacts WHERE place_id = ?").bind(id).run()
  await deliverVerification(env, attempt, new Date(now.getTime() + 120 * 60_000), id)
  expect(attempt).toHaveBeenCalledTimes(5)
  const filtered = filterForImport(
    {
      contacts: [
        {
          id: "c_fixture",
          email: "fixture@example.test",
          email_verified_at: null,
          email_verify_expires: new Date(now.getTime() + 86400_000).toISOString(),
          purge_after: new Date(now.getTime() + 86400_000).toISOString(),
          verify_mail_state: "due",
        },
      ],
    },
    now,
    REAL,
  )
  expect(filtered.contacts[0].verify_mail_state).toBe("uncertain")
})
