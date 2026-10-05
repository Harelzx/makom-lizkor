import { env } from "cloudflare:workers"
import { expect, it } from "vitest"
import { SUBMITTABLE_KINDS } from "@/shared/contract"
import { ADDABLE_KINDS } from "@/data/taxonomy"

it("refuses a status outside the state machine", async () => {
  await expect(
    env.DB.prepare(
      "INSERT INTO places (id, origin, status, rev, created_at, status_changed_at) VALUES ('p_x','contribution','live',1,'t','t')",
    ).run(),
  ).rejects.toThrow(/CHECK/)
})

it("keeps a private-property place approximate unless permission is recorded", async () => {
  await env.DB.prepare(
    "INSERT INTO places (id, origin, status, rev, created_at, status_changed_at) VALUES ('p_y','contribution','pending',1,'t','t')",
  ).run()
  await expect(
    env.DB.prepare(
      "INSERT INTO revisions (id, place_id, n, state, kind, name_he, lat, lng, location_precision, on_private_property, consent_version, created_at) VALUES ('r_y','p_y',1,'pending','bench','דמו',31.4,34.5,'exact',1,'v','t')",
    ).run(),
  ).rejects.toThrow(/CHECK/)
})

it("starts the feed at version zero", async () => {
  expect(await env.DB.prepare("SELECT n FROM feed_state WHERE id = 1").first("n")).toBe(0)
})

it("accepts exactly the kinds the form offers", () => {
  expect([...SUBMITTABLE_KINDS].sort()).toEqual([...ADDABLE_KINDS].sort())
})
