import { env } from "cloudflare:workers"
import { beforeEach, describe, expect, it } from "vitest"
import type { LedgerEntry } from "../lib/ledger"
import { call, purges } from "./app"
import { admin, approve, submit } from "./helpers"

/** The ledger as a bucket that refuses every write. */
const down = { put: async () => Promise.reject(new Error("down")) } as unknown as R2Bucket
const without = (bucket: R2Bucket): Env => ({ ...env, LEDGER: bucket })

async function entries(placeId: string) {
  const { objects } = await env.LEDGER.list({ prefix: `ledger/${placeId}/` })
  return Promise.all(objects.map(async (o) => (await env.LEDGER.get(o.key))!.json<LedgerEntry>()))
}
const status = (id: string) => env.DB.prepare("SELECT status FROM places WHERE id = ?").bind(id).first<string>("status")
const queued = async (id: string) => {
  const { items } = await (await admin("/api/admin/queue")).json<{ items: { id: string; rev: number; revisionId: string }[] }>()
  return items.find((i) => i.id === id)!
}
const decide = async (id: string, action: "approve" | "reject" | "return", e: Env = env) => {
  const item = await queued(id)
  return admin(
    `/api/admin/places/${id}/transitions`,
    {
      method: "POST",
      body: JSON.stringify({
        action,
        revisionId: item.revisionId,
        expectedRev: item.rev,
        ...(action === "return" ? { note: "נא לתקן" } : {}),
      }),
    },
    undefined,
    e,
  )
}
const withdraw = (id: string, token: string, e: Env = env) =>
  call(`http://local/api/v1/submissions/${id}/withdraw`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }, e)

beforeEach(() => void purges.splice(0))

describe("a moderator's decision is recorded", () => {
  it("an approval writes its intent and commit, and purges the place's tags once", async () => {
    const { id } = await submit()
    expect((await approve(id)).status).toBe(200)
    const kinds = (await entries(id)).map((e) => `${e.kind}:${e.phase}`)
    expect(kinds.sort()).toEqual(["approve:commit", "approve:intent"])
    expect((await entries(id)).find((e) => e.phase === "commit")).toMatchObject({
      actor: "moderator",
      status: "published",
      seq_from: 0,
      seq_to: 1,
    })
    expect(purges).toEqual([["feed", "tributes", `place:${id}`]])
  })

  it("a rejection and a return are recorded too, without a purge: the public saw nothing", async () => {
    const a = await submit()
    const b = await submit()
    expect((await decide(a.id, "reject")).status).toBe(200)
    expect((await decide(b.id, "return")).status).toBe(200)
    expect((await entries(a.id)).map((e) => e.kind)).toContain("reject")
    expect((await entries(b.id)).map((e) => e.kind)).toContain("return")
    expect(purges).toEqual([])
  })

  it("no approval happens unrecorded: with the ledger down it answers 503 and the place stays pending", async () => {
    const { id } = await submit()
    const res = await decide(id, "approve", without(down))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: "ledger_unavailable" })
    expect(res.headers.get("Retry-After")).toBeTruthy()
    expect(await status(id)).toBe("pending")
    expect(purges).toEqual([])
    // Once the ledger is back, the same decision goes through.
    expect((await decide(id, "approve")).status).toBe(200)
  })
})

describe("a withdrawal is recorded", () => {
  it("as the sender's removal, with a purge when the place was public", async () => {
    const { id, trackingToken } = await submit()
    await approve(id)
    purges.splice(0)
    expect((await withdraw(id, trackingToken)).status).toBe(200)
    const commit = (await entries(id)).find((e) => e.kind === "withdraw" && e.phase === "commit")
    expect(commit).toMatchObject({ actor: "submitter", removal: true, status: "withdrawn" })
    expect(purges).toEqual([["feed", "tributes", `place:${id}`]])
  })

  it("goes ahead with the ledger down, and leaves a repair the scheduled job can finish", async () => {
    const { id, trackingToken } = await submit()
    await approve(id)
    expect((await withdraw(id, trackingToken, without(down))).status).toBe(200)
    expect(await status(id)).toBe("withdrawn")
    const op = await env.DB.prepare("SELECT intent, ledger_commit FROM visibility_ops WHERE place_id = ? AND kind = 'withdraw'")
      .bind(id)
      .first()
    expect(op).toEqual({ intent: "failed", ledger_commit: "failed" })
  })

  it("of a place never published, purges nothing", async () => {
    const { id, trackingToken } = await submit()
    expect((await withdraw(id, trackingToken)).status).toBe(200)
    expect(purges).toEqual([])
  })
})
