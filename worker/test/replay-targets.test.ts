import { env } from "cloudflare:workers"
import { expect, it } from "vitest"
import { replayDecision, type LedgerEntry } from "../lib/ledger"
import { call } from "./app"
import { admin, approve, submit } from "./helpers"

type View = { rev: number; suppressions: { id: string; field: string; kind: string }[] }
const view = async (id: string) => (await admin(`/api/admin/places/${id}`)).json<View>()
const ledger = async (placeId: string) => {
  const { objects } = await env.LEDGER.list({ prefix: `ledger/${placeId}/` })
  return Promise.all(objects.map(async (o) => (await env.LEDGER.get(o.key))!.json<LedgerEntry>()))
}

it("a manual hide and an automatic one on the same field, and only the manual one lifted: replaying the ledger leaves exactly the automatic one", async () => {
  const { id } = await submit("גינת דמו")
  await approve(id)
  const { ledger_seq: restorePoint } = (await env.DB.prepare("SELECT ledger_seq FROM places WHERE id = ?")
    .bind(id)
    .first<{ ledger_seq: number }>())!

  const { rev } = await view(id)
  const hid = await admin("/api/admin/suppressions", {
    method: "POST",
    body: JSON.stringify({ placeId: id, fields: ["name_he"], expectedRev: rev, reason: "בקשת משפחה בטלפון" }),
  })
  expect(hid.status).toBe(200)
  const report = await call("http://local/api/v1/reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
      "Turnstile-Token": "pass-report",
    },
    body: JSON.stringify({
      placeId: id,
      elements: ["name_he"],
      requesterType: "family",
      relationship: "אח",
      explanation: `שם אחי מופיע כאן בלי רשות, נבקש להסיר אותו. ${crypto.randomUUID()}`,
      noticeVersion: "notice.report@2026-10-2",
    }),
  })
  expect((await report.json<{ outcome: string }>()).outcome).toBe("hidden_for_review")
  const both = (await view(id)).suppressions
  const manual = both.find((s) => s.kind === "manual")!
  const automatic = both.find((s) => s.kind === "precautionary")!
  expect([manual.field, automatic.field]).toEqual(["name_he", "name_he"])

  const lifted = await admin(`/api/admin/suppressions/${manual.id}/lift`, {
    method: "POST",
    body: JSON.stringify({
      expectedRev: (await view(id)).rev,
      basisCode: "review_supports_restore",
      basisNote: "בדקנו מול אתר המועצה.",
      confirm: { affirmativeBasis: true, notNonresponseOrDispute: true },
    }),
  })
  expect(lifted.status).toBe(200)

  // A restore from before the hides, replayed: each hide adds the rows it names, each restoration removes its own.
  const { apply, quarantine } = replayDecision(await ledger(id), restorePoint)
  expect(quarantine).toBe(false)
  const active = new Set<string>()
  for (const e of apply) {
    if (e.kind === "suppress") for (const t of e.targets ?? []) active.add(t)
    if (e.kind === "lift") for (const t of e.targets ?? []) active.delete(t)
  }
  expect([...active]).toEqual([automatic.id])
  expect((await view(id)).suppressions.map((s) => s.id)).toEqual([automatic.id])
})
