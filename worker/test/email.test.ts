import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { CURRENT_SUBMISSION_NOTICE } from "@/shared/contract"
import { call } from "./app"
import { admin } from "./helpers"

type Mail = { to: string; subject: string; text: string }
const mails = async (to: string) =>
  (
    await env.DB.prepare('SELECT to_address AS "to", subject, body AS text FROM dev_outbox WHERE to_address = ? ORDER BY at, id')
      .bind(to)
      .all<Mail>()
  ).results
const send = async (name: string, email?: string) => {
  const res = await call("http://local/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""), "Turnstile-Token": "pass" },
    body: JSON.stringify({
      kind: "bench",
      name_he: name,
      lat: 31.42,
      lng: 34.49,
      consent_version: CURRENT_SUBMISSION_NOTICE,
      ...(email ? { email } : {}),
    }),
  })
  return { status: res.status, ...(await res.json<{ id: string; trackingToken: string }>()) }
}
/** A moment this many minutes from now, for the development clock. */
const minutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString()
const linkIn = (text: string, path: string) => new RegExp(`#/${path}/([^\\s]+)`).exec(text)?.[1]
const verify = (token: string, now?: string) =>
  call("http://local/api/v1/email/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(now ? { "X-Test-Now": now } : {}) },
    body: JSON.stringify({ token }),
  })
const decide = async (id: string, action: string, note?: string) => {
  const { items } = await (await admin("/api/admin/queue")).json<{ items: { id: string; rev: number; revisionId: string }[] }>()
  const item = items.find((i) => i.id === id)!
  return admin(`/api/admin/places/${id}/transitions`, {
    method: "POST",
    body: JSON.stringify({ action, revisionId: item.revisionId, expectedRev: item.rev, ...(note ? { note } : {}) }),
  })
}

describe("an optional email", () => {
  it("is not needed, and a wrong one is refused", async () => {
    expect((await send("ספסל דמו בלי מייל")).status).toBe(201)
    expect((await send("ספסל דמו מייל שגוי", "not-an-address")).status).toBe(400)
  })
  it("gets a verification mail first, with nothing private in it", async () => {
    const to = `a${Date.now()}@example.test`
    const { id } = await send("ספסל דמו פרטי", to)
    const [first, ...rest] = await mails(to)
    expect(rest).toHaveLength(0)
    expect(first.text).not.toContain("ספסל דמו פרטי")
    expect(first.text).not.toContain(id)
    expect(first.text).not.toContain("#/track/")
    expect(linkIn(first.text, "verify")).toBeTruthy()
    const row = await env.DB.prepare("SELECT email, email_verified_at FROM contacts WHERE place_id = ?").bind(id).first()
    expect(row).toEqual({ email: to, email_verified_at: null })
  })
  it("once verified, gets a tracking link of its own that opens the status", async () => {
    const to = `b${Date.now()}@example.test`
    const { id, trackingToken } = await send("ספסל דמו מאומת", to)
    const token = linkIn((await mails(to))[0].text, "verify")!
    expect((await verify("wrong")).status).toBe(404)
    expect((await verify(token)).status).toBe(200)
    expect((await verify(token)).status).toBe(200) // a second click changes nothing
    const all = await mails(to)
    expect(all).toHaveLength(2)
    const link = linkIn(all[1].text, "track")!
    const [trackId, emailToken] = link.split("/")
    expect(trackId).toBe(id)
    expect(emailToken).not.toBe(trackingToken)
    const status = await call(`http://local/api/v1/submissions/${id}`, { headers: { Authorization: `Bearer ${emailToken}` } })
    expect(status.status).toBe(200)
    // the device's own link still works too
    expect((await call(`http://local/api/v1/submissions/${id}`, { headers: { Authorization: `Bearer ${trackingToken}` } })).status).toBe(
      200,
    )
  })
  it("can't be verified after seven days", async () => {
    const to = `c${Date.now()}@example.test`
    await send("ספסל דמו ישן", to)
    const token = linkIn((await mails(to))[0].text, "verify")!
    const later = new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString()
    expect((await verify(token, later)).status).toBe(404)
  })
  it("hears about decisions only once verified, with the moderator's note", async () => {
    const quiet = `d${Date.now()}@example.test`
    const a = await send("ספסל דמו לא מאומת", quiet)
    await decide(a.id, "approve")
    expect(await mails(quiet)).toHaveLength(1) // the verification mail only

    const told = `e${Date.now()}@example.test`
    const b = await send("ספסל דמו מקבל הודעות", told)
    await verify(linkIn((await mails(told))[0].text, "verify")!)
    await decide(b.id, "return", "נא להוסיף את שם היישוב")
    const last = (await mails(told)).at(-1)!
    expect(last.text).toContain("נא להוסיף את שם היישוב")
  })
  it("is erased with the place when the sender withdraws it", async () => {
    const to = `f${Date.now()}@example.test`
    const { id, trackingToken } = await send("ספסל דמו נמחק עם מייל", to)
    await call(`http://local/api/v1/submissions/${id}/withdraw`, { method: "POST", headers: { Authorization: `Bearer ${trackingToken}` } })
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM contacts WHERE email = ?").bind(to).first("n")).toBe(0)
  })
})

describe("a tracking mail that couldn't be sent", () => {
  it("is sent by a later click on the confirmation page, with the same link, and only a few times", async () => {
    const { createApp } = await import("../index")
    const { sendMail } = await import("../lib/mail")
    const { fakeSiteverify } = await import("./app")
    const { createExecutionContext } = await import("cloudflare:test")
    let down = true
    let tries = 0
    const flaky = createApp({
      verifyTurnstile: fakeSiteverify,
      sendMail: async (e, m) => (tries++, down ? false : sendMail(e, m)),
      purge: async () => true,
    })
    const verifyVia = (token: string, at = 0) =>
      flaky.fetch(
        new Request("http://local/api/v1/email/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Test-Now": minutes(at) },
          body: JSON.stringify({ token }),
        }),
        env,
        createExecutionContext(),
      )
    const to = `retry${Date.now()}@example.test`
    const { id } = await send("ספסל דמו מייל שנכשל", to)
    const verifyToken = linkIn((await mails(to))[0].text, "verify")!
    // The page is told the mail didn't go, so the visitor knows to try again; the next click is told it went.
    const failed = await verifyVia(verifyToken)
    expect(failed.status).toBe(200)
    expect(await failed.json()).toMatchObject({ first: true, mail: "failed" })
    expect((await mails(to)).length).toBe(1) // the verification mail only: the tracking mail failed
    down = false
    // A click right after a failed try waits for the gap and uses no try; one after it sends.
    const triesBefore = tries
    expect(await (await verifyVia(verifyToken, 1)).json()).toMatchObject({ mail: "failed" })
    expect(tries).toBe(triesBefore)
    expect(await (await verifyVia(verifyToken, 3)).json()).toMatchObject({ first: false, mail: "sent" })
    const tracking = (await mails(to)).filter((m) => m.text.includes("#/track/"))
    expect(tracking).toHaveLength(1)
    // The link works.
    const token = linkIn(tracking[0].text, `track/${id}`)!
    const status = await call(`http://local/api/v1/submissions/${id}`, { headers: { Authorization: `Bearer ${token}` } })
    expect(status.status).toBe(200)
    // Sent once: more clicks send nothing more.
    const before = tries
    expect(await (await verifyVia(verifyToken, 4)).json()).toMatchObject({ first: false, mail: "earlier" })
    expect(tries).toBe(before)
  })

  it("stops trying after five failed sends", async () => {
    const { createApp } = await import("../index")
    const { fakeSiteverify } = await import("./app")
    const { createExecutionContext } = await import("cloudflare:test")
    let tries = 0
    const dead = createApp({ verifyTurnstile: fakeSiteverify, sendMail: async () => (tries++, false), purge: async () => true })
    const to = `dead${Date.now()}@example.test`
    await send("ספסל דמו מייל מת", to)
    const verifyToken = linkIn((await mails(to))[0].text, "verify")!
    const click = async (at: number) =>
      (
        await dead.fetch(
          new Request("http://local/api/v1/email/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Test-Now": minutes(at) },
            body: JSON.stringify({ token: verifyToken }),
          }),
          env,
          createExecutionContext(),
        )
      ).json<{ mail: string }>()
    // Clicks in quick succession use one try, not five: the button can't spend them all in a minute.
    for (const at of [0, 0.2, 0.5, 1]) await click(at)
    expect(tries).toBe(1)
    // Spaced out, four more tries; the fifth failure says at once that it won't be tried again.
    const answers = []
    for (const at of [3, 6, 9, 12]) answers.push((await click(at)).mail)
    expect(answers).toEqual(["failed", "failed", "failed", "stopped"])
    expect((await click(20)).mail).toBe("stopped")
    expect(tries).toBe(5)
  })
})
