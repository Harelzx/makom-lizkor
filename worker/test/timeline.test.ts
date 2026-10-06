import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { beforeAll, expect, it } from "vitest"
import { evidence } from "./log-guard"
import { RETENTION } from "@/config"
import { CURRENT_REPORT_NOTICE, CURRENT_SUBMISSION_NOTICE } from "@/shared/contract"
import { checkDeletion } from "../db/exports"
import { runJobs } from "../jobs"
import { ulidTime } from "../lib/ids"
import { sendMail } from "../lib/mail"
import { sha256, unseal, type Manifest } from "../lib/sealed"
import { call } from "./app"
import { admin, approve } from "./helpers"
import { decide, jpeg, queued, send, upload } from "./submission-helpers"

/**
 * Phase 5 task 5: every deletion date, end to end and locally. Real requests and the real scheduled pass, run on a
 * simulated clock from now through day 722, over the real RETENTION values: for each date, the last pass that still
 * finds the item (in D1, the photo bucket or inside a decrypted backup) and the first that doesn't. The table is printed
 * as JSON (TIMELINE …) for the evidence directory. Staging repeats it against real time (Phase 6).
 */
const DAY = 86_400_000
const PASSES = [...Array.from({ length: 41 }, (_, d) => d), 89, 90, 91, 92, 123, 124, 125, 719, 720, 721]
let keys: { pub: string; priv: JsonWebKey }

beforeAll(async () => {
  await applyD1Migrations(env.IMPORT_TEST, env.TEST_MIGRATIONS)
  const pair = (await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  )) as CryptoKeyPair
  keys = {
    pub: JSON.stringify([await crypto.subtle.exportKey("jwk", pair.publicKey)]),
    priv: (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey,
  }
})

const count = async (sql: string, ...values: unknown[]) =>
  (await env.DB.prepare(sql)
    .bind(...values)
    .first<number>("n")) ?? 0
const inBackups = async (needle: string) => {
  const { objects } = await env.EXPORTS.list({ prefix: "exports/" })
  for (const o of objects.filter((x) => x.key.endsWith("/manifest.json"))) {
    const manifest = (await (await env.EXPORTS.get(o.key))!.json()) as Manifest
    const data = await env.EXPORTS.get(manifest.data.key)
    if (!data) continue
    const plain = await unseal(new Uint8Array(await data.arrayBuffer()), manifest.data, keys.priv)
    const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
    if (text.includes(needle)) return true
  }
  return false
}

it("keeps every deletion date the notices give, end to end", { timeout: 600_000 }, async () => {
  const T0 = Date.now()
  const at = (day: number) => new Date(T0 + day * DAY + 60_000)
  const jobsEnv = { ...env, EXPORT_PUBLIC_KEYS: keys.pub, DRILL_DB: env.IMPORT_TEST, DRILL_PRIVATE_KEY: JSON.stringify(keys.priv) } as Env

  // Day 0, through the real API.
  const returned = await send("ספסל דמו שהוחזר בציר הזמן")
  expect((await decide(returned.id, await queued(returned.id), "return", "הערת דמו בציר הזמן")).status).toBe(200)
  const refused = await send("ספסל דמו שנדחה בציר הזמן")
  expect((await decide(refused.id, await queued(refused.id), "reject")).status).toBe(200)
  const email = `timeline-${crypto.randomUUID().slice(0, 8)}@example.test`
  const res = await call("http://local/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""), "Turnstile-Token": "pass" },
    body: JSON.stringify({
      kind: "bench",
      name_he: "ספסל דמו עם מייל בציר הזמן",
      lat: 31.42,
      lng: 34.49,
      consent_version: CURRENT_SUBMISSION_NOTICE,
      email,
    }),
  })
  const mailed = await res.json<{ id: string; trackingToken: string }>()
  const inbox = async () =>
    (await env.DB.prepare("SELECT body FROM dev_outbox WHERE to_address = ?").bind(email).all<{ body: string }>()).results
  const verify = /#\/verify\/(\S+)/.exec((await inbox())[0].body)![1]
  await call("http://local/api/v1/email/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: verify }),
  })
  const emailToken = new RegExp(`#/track/${mailed.id}/(\\S+)`).exec((await inbox()).map((m) => m.body).join("\n"))![1]
  await approve(mailed.id)
  const withdrawn = await send("גן דמו שנמשך ביום 2")
  expect((await upload(withdrawn.id, withdrawn.trackingToken, jpeg(0x44))).status).toBe(200)
  expect((await decide(withdrawn.id, await queued(withdrawn.id), "approve")).status).toBe(200)
  const withdrawnKey = (await env.DB.prepare(
    "SELECT r.photo_key AS k FROM places p JOIN revisions r ON r.id = p.published_revision_id WHERE p.id = ?",
  )
    .bind(withdrawn.id)
    .first<string>("k"))!
  const withdrawnHash = await sha256(new Uint8Array(await (await env.MEDIA.get(withdrawnKey))!.arrayBuffer()))
  const waiting = await send("ספסל דמו שתמונתו לא נבדקה")
  expect((await upload(waiting.id, waiting.trackingToken, jpeg(0x45))).status).toBe(200)
  const waitingKey = (await env.DB.prepare("SELECT photo_key AS k FROM revisions WHERE place_id = ?").bind(waiting.id).first<string>("k"))!
  await call("http://local/api/v1/tributes", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", "") },
    body: JSON.stringify({ placeId: mailed.id, deviceId: crypto.randomUUID().replaceAll("-", "") }),
  })
  const filed = await call("http://local/api/v1/reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
      "Turnstile-Token": "pass-report",
    },
    body: JSON.stringify({
      placeId: mailed.id,
      elements: ["story_he"],
      requesterType: "family",
      relationship: "אחות",
      explanation: "הסבר דמו לבקשה בציר הזמן, מספיק ארוך כדי להיחשב בקשה מלאה",
      email: "reporter-timeline@example.test",
      noticeVersion: CURRENT_REPORT_NOTICE,
    }),
  })
  const { ticket } = await filed.json<{ ticket: string }>()
  expect(
    (await admin(`/api/admin/reports/${ticket}/close`, { method: "POST", body: JSON.stringify({ note: "טופל בציר הזמן" }) })).status,
  ).toBe(200)

  // What each date's probe finds at a pass.
  const probes: Record<string, () => Promise<boolean>> = {
    returned_submission: async () =>
      (await count("SELECT COUNT(*) AS n FROM revisions WHERE place_id = ? AND name_he IS NOT NULL", returned.id)) > 0,
    refused_submission: async () =>
      (await count("SELECT COUNT(*) AS n FROM revisions WHERE place_id = ? AND name_he IS NOT NULL", refused.id)) > 0,
    contact: async () => (await count("SELECT COUNT(*) AS n FROM contacts WHERE place_id = ?", mailed.id)) > 0,
    emailed_link: async () =>
      (await call(`http://local/api/v1/submissions/${mailed.id}`, { headers: { Authorization: `Bearer ${emailToken}` } })).status === 200,
    request_text: async () => (await count("SELECT COUNT(*) AS n FROM reports WHERE id = ? AND explanation IS NOT NULL", ticket)) > 0,
    anemone_record: async () => (await count("SELECT COUNT(*) AS n FROM tribute_events WHERE place_id = ?", mailed.id)) > 0,
    unapproved_photo: async () => !!(await env.MEDIA.head(waitingKey)),
    withdrawn_photo_backup: async () => !!(await env.EXPORTS.head(`photos/${withdrawnHash}`)),
    // The rows day 0's decisions wrote (the erasure on day 30 writes its own, with its own 24 months).
    audit_rows: async () =>
      (await count("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ? AND at < ?", returned.id, new Date(T0 + DAY).toISOString())) >
      0,
  }
  // Only on the days around its date: each look decrypts every export.
  const backupDays = new Set([89, 90, 91, 92, 123, 124, 125])
  const seen: Record<string, { last: number | null; gone: number | null }> = {}
  const findings: { day: number; found: Record<string, number> }[] = []
  let reminderDay: number | null = null
  let oldestExportDays = 0

  for (const day of PASSES) {
    if (day === 2)
      expect(
        (
          await call(`http://local/api/v1/submissions/${withdrawn.id}/withdraw`, {
            method: "POST",
            headers: { Authorization: `Bearer ${withdrawn.trackingToken}` },
          })
        ).status,
      ).toBe(200)
    await runJobs(jobsEnv, { sendMail, purge: async () => true }, undefined, at(day))
    const look = { ...probes, ...(backupDays.has(day) ? { contact_in_backups: () => inBackups(email) } : {}) }
    for (const [name, probe] of Object.entries(look)) {
      const s = (seen[name] ??= { last: null, gone: null })
      if (await probe()) s.last = day
      else if (s.gone === null && s.last !== null) s.gone = day
    }
    const found = await checkDeletion({ db: env.DB, exports: env.EXPORTS, keys: keys.pub }, at(day))
    if (Object.keys(found).length) findings.push({ day, found })
    if (reminderDay === null && (await count("SELECT COUNT(*) AS n FROM dev_outbox WHERE subject LIKE '%ממתינות לבדיקה%'")) > 0)
      reminderDay = day
    const { objects } = await env.EXPORTS.list({ prefix: "exports/" })
    // An export's age from its id (the simulated moment it was made), as the pruning reads it.
    for (const o of objects)
      oldestExportDays = Math.max(oldestExportDays, (at(day).getTime() - ulidTime(o.key.split("/")[1].slice(3))) / DAY)
  }

  // Each date: the notice's promise, the day the job acts (a pass a day), and what was found.
  const expected: Record<string, { promise: string; last: number; gone: number }> = {
    returned_submission: { promise: `${RETENTION.returnedDays} days after the return`, last: 29, gone: 30 },
    refused_submission: { promise: `${RETENTION.rejectedTextDays} days after the refusal`, last: 29, gone: 30 },
    contact: { promise: `${RETENTION.contactAfterCloseDays} days after the decision`, last: 89, gone: 90 },
    emailed_link: { promise: "works while the address is kept", last: 89, gone: 90 },
    request_text: { promise: `${RETENTION.contactAfterCloseDays} days after the request closed`, last: 89, gone: 90 },
    anemone_record: { promise: `after ${RETENTION.tributeDays} days`, last: 7, gone: 8 },
    unapproved_photo: { promise: `within ${RETENTION.rejectedPhotoDays} days of the upload`, last: 28, gone: 29 },
    withdrawn_photo_backup: { promise: `backups within ${RETENTION.backupTailDays} days`, last: 35, gone: 36 },
    contact_in_backups: { promise: `backups within ${RETENTION.backupTailDays} days of day 90`, last: 123, gone: 124 },
    audit_rows: { promise: `${RETENTION.auditMonths} months (720 days)`, last: 719, gone: 720 },
  }
  const table = Object.entries(expected).map(([name, e]) => ({ name, ...e, found_last: seen[name]?.last, found_gone: seen[name]?.gone }))
  const drills = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(ok) AS ok FROM drill_runs").first<{ n: number; ok: number }>()
  evidence(`TIMELINE ${JSON.stringify({ T0: new Date(T0).toISOString(), table, findings, reminderDay, oldestExportDays, drills })}`)

  for (const row of table)
    expect({ name: row.name, last: row.found_last, gone: row.found_gone }).toEqual({ name: row.name, last: row.last, gone: row.gone })
  expect(findings).toEqual([])
  expect(reminderDay).toBe(RETENTION.reviewReminderDays)
  expect(oldestExportDays).toBeLessThanOrEqual(35)
  expect(drills).toMatchObject({ ok: drills!.n })
  expect(drills!.n).toBeGreaterThan(0)
})
