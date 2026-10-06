import { env } from "cloudflare:workers"
import { expect, it } from "vitest"
import { admin } from "./helpers"

/** Requests stored directly, many more than one page: received a minute apart, two in each minute sharing a time. */
async function manyRequests(n: number, tag: string) {
  const stmts = []
  for (let i = 0; i < n; i++) {
    const at = new Date(Date.UTC(2029, 0, 1, 0, Math.floor(i / 2))).toISOString()
    stmts.push(
      env.DB.prepare(
        `INSERT INTO reports (id, place_id, origin, elements, requester_type, explanation, notice_version, submit_key_hash, body_hash,
           complete, outcome, status, received_at, ceiling_at, purge_after)
         VALUES (?1, 'p_pages', 'contribution', '["name_he"]', 'other', 'דמו', 'notice.report@2026-10-2', ?1, 'b', 0, 'received', 'open', ?2, '2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z')`,
      ).bind(`r_${tag}_${String(i).padStart(4, "0")}`, at),
    )
  }
  await env.DB.batch(stmts)
}

async function allPages(path: string, key: "items" | "ops") {
  const seen: string[] = []
  let cursor: string | null = null
  for (let page = 0; page < 50; page++) {
    const res: Response = await admin(`${path}${path.includes("?") ? "&" : "?"}${cursor ? `cursor=${encodeURIComponent(cursor)}` : ""}`)
    const body = await res.json<Record<string, unknown> & { next: string | null }>()
    seen.push(...(body[key] as { id: string }[]).map((x) => x.id))
    cursor = body.next
    if (!cursor) break
  }
  return seen
}

it("every open request can be reached, page after page, however many there are (F4-A6)", async () => {
  await manyRequests(230, "pages")
  const seen = (await allPages("/api/admin/reports?status=open", "items")).filter((id) => id.startsWith("r_pages_"))
  expect(seen).toHaveLength(230)
  expect(new Set(seen).size).toBe(230)
  // Newest first, oldest reachable.
  expect(seen[0]).toBe("r_pages_0229")
  expect(seen.at(-1)).toBe("r_pages_0000")
})

it("every operation needing attention can be reached too (F4-A6)", async () => {
  const stmts = []
  for (let i = 0; i < 130; i++) {
    const at = new Date(Date.UTC(2029, 1, 1, 0, Math.floor(i / 2))).toISOString()
    stmts.push(
      env.DB.prepare(
        `INSERT INTO visibility_ops (id, place_id, kind, actor, removal, expected_rev, seq_from, detail, state, refused_reason, intent, media,
           ledger_commit, purge, created_at, updated_at)
         VALUES (?1, 'p_attention', 'suppress', 'moderator', 1, 1, 0, '{}', 'refused', 'interrupted', 'written', 'none', 'pending', 'none', ?2, ?2)`,
      ).bind(`t_att_${String(i).padStart(4, "0")}`, at),
    )
  }
  await env.DB.batch(stmts)
  const seen = (await allPages("/api/admin/attention", "ops")).filter((id) => id.startsWith("t_att_"))
  expect(seen).toHaveLength(130)
  expect(new Set(seen).size).toBe(130)
  expect(seen.at(-1)).toBe("t_att_0000")
})

it("a malformed cursor is refused, not read as the first page", async () => {
  expect((await admin("/api/admin/reports?cursor=nonsense")).status).toBe(400)
})
