import { env } from "cloudflare:workers"
import { expect, it } from "vitest"
import { PUBLIC_PHOTO_SQL } from "../db/public-photo"

it("photo keys and selective contact/pending queries use indexes without scanning places", async () => {
  const plan = async (sql: string, values: string[] = []) =>
    (
      await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .bind(...values)
        .all<{ detail: string }>()
    ).results
      .map((r) => r.detail)
      .join("\n")
  const media = await plan(PUBLIC_PHOTO_SQL, ["public/test/never-live.jpg"])
  for (const index of ["revisions_photo_key", "revision_photos_key", "revision_photos_thumb"]) expect(media).toContain(index)
  expect(media).not.toMatch(/SCAN p\b/)
  expect(await plan("SELECT COUNT(*) FROM revisions WHERE state = 'pending'")).toContain("revisions_pending_created")
  expect(await plan("SELECT email FROM contacts WHERE place_id = ? AND email_verified_at IS NOT NULL", ["p_test"])).toContain(
    "contacts_by_place",
  )
})
