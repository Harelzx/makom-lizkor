// L-RET A2's fresh synthetic cohort (a104/a106), made right after the deploy that carries RETENTION_DAY_SECONDS=7200 and
// staging's export keys. Every name carries the synthetic mark and the cohort's marker. Records ids, states, UTC times
// and the deadlines the staged day implies (2 h a day): the receipt the later observation is read against.
//   MACHINE='{…}' NOTICE=… EXPECT_TAG=staging-<sha12> node tools/l-ret/a2-cohort.mjs <base-url> <receipt.json>
import { writeFileSync } from "node:fs"

import { stagingRequester } from "./guards.mjs"

const [base, out] = process.argv.slice(2)
const machine = JSON.parse(process.env.MACHINE ?? "null")
const { NOTICE, EXPECT_TAG } = process.env
if (!base || !out || !machine?.["CF-Access-Client-Id"] || !NOTICE || !EXPECT_TAG) throw new Error("usage: see the header")
const resume = JSON.parse(process.env.RESUME || "null")
const run = resume?.run ?? crypto.randomUUID().replaceAll("-", "").slice(0, 8)
const marker = `A2-${run}`
const DAY = 2 * 3600_000 // the staged day
const key = () => crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "").slice(0, 8)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ask = stagingRequester(base, machine, EXPECT_TAG)
// Check the read-only endpoint before the first state-changing request.
if ((await ask("/api/v1/health")).status !== 200) throw new Error("Staging health check failed")
const receipt = { marker, base, expectTag: EXPECT_TAG, started: new Date().toISOString(), items: [] }
const submitted = {}
const submit = async (role) => {
  const r = await ask("/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key(), "Turnstile-Token": "XXXX.DUMMY.TOKEN.XXXX" },
    body: JSON.stringify({ kind: "bench", name_he: `[סינתטי] ${role} ${marker}`, lat: 31.42, lng: 34.49, consent_version: NOTICE }),
  })
  if (r.status !== 201) throw new Error(`submission (${role}) answered ${r.status}`)
  submitted[r.body.id] = r.body.trackingToken
  return r.body.id
}
const queued = async (id) => {
  for (let i = 0; i < 30; i++) {
    const q = await ask("/api/admin/queue")
    const item = q.body?.items?.find((x) => x.id === id)
    if (item) return item
    await sleep(1000)
  }
  throw new Error(`${id} never reached the queue`)
}
const decide = async (id, action, note) => {
  const item = await queued(id)
  const r = await ask(`/api/admin/places/${id}/transitions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify({ action, revisionId: item.revisionId, expectedRev: item.rev, ...(note ? { note } : {}) }),
  })
  if (r.status !== 200) throw new Error(`${action} ${id} answered ${r.status}`)
  return new Date()
}
const at = (d, days) => new Date(d.getTime() + days * DAY).toISOString()

let published
if (resume) {
  // The first four, made by an earlier run of this script; their times are the database's own (status_changed_at).
  receipt.resumed = { started: resume.started, note: resume.note }
  for (const i of resume.items) {
    const d = new Date(i.at)
    const deadline = i.role === "returned" || i.role === "rejected" ? at(d, 30) : null
    const expected = {
      published: "stays while published",
      returned: "erased 30 staged days after the return, uncorrected (returnedDays)",
      rejected: "its text erased 30 staged days after the refusal (rejectedTextDays); the tombstone stays",
      pending: "waits; the review reminder runs on staged days",
    }[i.role]
    receipt.items.push({ role: i.role, id: i.id, at: i.at, deadline, expected })
  }
  published = resume.items.find((i) => i.role === "published").id
} else {
  published = await submit("פורסם")
  const pAt = await decide(published, "approve")
  receipt.items.push({ role: "published", id: published, at: pAt.toISOString(), deadline: null, expected: "stays while published" })
  const returned = await submit("הוחזר")
  const rAt = await decide(returned, "return", `[סינתטי] הערה להחזרה ${marker}`)
  receipt.items.push({
    role: "returned",
    id: returned,
    at: rAt.toISOString(),
    deadline: at(rAt, 30),
    expected: "erased 30 staged days after the return, uncorrected (returnedDays)",
  })
  const rejected = await submit("נדחה")
  const xAt = await decide(rejected, "reject", `[סינתטי] הערה לדחייה ${marker}`)
  receipt.items.push({
    role: "rejected",
    id: rejected,
    at: xAt.toISOString(),
    deadline: at(xAt, 30),
    expected: "its text erased 30 staged days after the refusal (rejectedTextDays); the tombstone stays",
  })
  const pending = await submit("ממתין")
  receipt.items.push({
    role: "pending",
    id: pending,
    at: new Date().toISOString(),
    deadline: null,
    expected: "waits; the review reminder runs on staged days",
  })
}
const deviceId = crypto.randomUUID().replaceAll("-", "")
const t = await ask("/api/v1/tributes", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", "") },
  body: JSON.stringify({ placeId: published, deviceId }),
})
if (t.status !== 200 || !t.body?.counted) throw new Error(`tribute answered ${t.status}`)
const tAt = new Date()
receipt.items.push({
  role: "tribute",
  id: published,
  at: tAt.toISOString(),
  deadline: at(tAt, 8),
  expected: "the tribute event's row gone after 8 staged days (tributeDays); the count stays",
})
// L-RET E2 (Harel's 7 October evening direction: real-cloud boundary checks within hours). Withdrawn: its revision is
// blanked in the same database step, so no export after it may hold its marker.
const withdrawn = await submit("נמשך")
await queued(withdrawn)
const w = await ask(`/api/v1/submissions/${withdrawn}/withdraw`, {
  method: "POST",
  headers: { Authorization: `Bearer ${submitted[withdrawn]}` },
})
if (w.status !== 200 || w.body?.status !== "withdrawn") throw new Error(`withdrawal answered ${w.status}`)
const wAt = new Date()
receipt.items.push({
  role: "withdrawn",
  id: withdrawn,
  at: wAt.toISOString(),
  deadline: wAt.toISOString(),
  expected: "its revision blank at once; no export created after this moment holds its text",
})
// A removal request from someone who is neither family nor a rights holder: no precaution, no backstop; its two abuse
// codes (reporter_key, explanation_hash) are cleared by the job reportAbuseCodeHours (24 staged hours) after it came.
const report = await ask("/api/v1/reports", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Idempotency-Key": key(), "Turnstile-Token": "XXXX.DUMMY.TOKEN.XXXX" },
  body: JSON.stringify({
    placeId: published,
    elements: ["story_he"],
    requesterType: "other",
    explanation: `[סינתטי] בקשה לבדיקת מועדי המחיקה בסביבת הבדיקה בלבד ${marker}`,
    noticeVersion: "notice.report@2026-10-3",
  }),
})
if (report.status !== 202 || !report.body?.ticket) throw new Error(`report answered ${report.status}`)
const rpAt = new Date()
receipt.items.push({
  role: "report",
  id: report.body.ticket,
  place: published,
  at: rpAt.toISOString(),
  deadline: new Date(rpAt.getTime() + DAY).toISOString(),
  expected:
    "reporter_key and explanation_hash NULL by the first job run after 24 staged hours (reportAbuseCodeHours); the request itself stays",
})
receipt.finished = new Date().toISOString()
writeFileSync(out, JSON.stringify(receipt, null, 1))
for (const i of receipt.items) console.log(`${i.role}: ${i.id} at ${i.at}${i.deadline ? `, deadline ${i.deadline}` : ""}`)
console.log(`marker ${marker}; receipt ${out}`)
