import { env } from "cloudflare:workers"
import { describe, expect, it } from "vitest"
import { CURRENT_SUBMISSION_NOTICE } from "@/shared/contract"
import { call } from "./app"
import { approve } from "./helpers"

const send = (name: string, extra: Record<string, unknown>) =>
  call("http://local/api/v1/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""), "Turnstile-Token": "pass" },
    body: JSON.stringify({
      kind: "garden",
      name_he: name,
      lat: 31.423456,
      lng: 34.498765,
      consent_version: CURRENT_SUBMISSION_NOTICE,
      ...extra,
    }),
  })
const published = async (id: string) => {
  const v = (await (await call("http://local/api/v1/version")).json<{ v: string }>()).v
  const feed = await (await call(`http://local/api/v1/feed?v=${v}`)).json<{ places: Record<string, unknown>[] }>()
  return feed.places.find((p) => p.id === id)
}

describe("a place on private property", () => {
  it("is kept and shown only approximately, to about a kilometre, unless the owner allowed more", async () => {
    const { id } = await (await send("גינת דמו בחצר", { on_private_property: true })).json<{ id: string }>()
    const rev = await env.DB.prepare("SELECT lat, lng, location_precision FROM revisions WHERE place_id = ?").bind(id).first()
    expect(rev).toEqual({ lat: 31.42, lng: 34.5, location_precision: "approximate" })
    await approve(id)
    expect(await published(id)).toMatchObject({ precision: "approx", lat: 31.42, lng: 34.5 })
    expect(await published(id)).not.toHaveProperty("access_note")
  })
  it("is shown exactly, with how to visit, when the owner allowed it", async () => {
    const res = await send("גינת דמו ברשות", {
      on_private_property: true,
      location_permission: true,
      access_note_he: "בתיאום מראש עם המשפחה",
    })
    expect(res.status).toBe(201)
    const { id } = await res.json<{ id: string }>()
    const rev = await env.DB.prepare(
      "SELECT lat, location_precision, location_permission_at IS NOT NULL AS allowed FROM revisions WHERE place_id = ?",
    )
      .bind(id)
      .first()
    expect(rev).toEqual({ lat: 31.423456, location_precision: "exact", allowed: 1 })
    await approve(id)
    expect(await published(id)).toMatchObject({ precision: "exact", access_note: "בתיאום מראש עם המשפחה" })
  })
  it("needs a note on access when permission is claimed, and permission only means something on private property", async () => {
    expect((await send("גינת דמו בלי הערה", { on_private_property: true, location_permission: true })).status).toBe(400)
    expect((await send("גינת דמו ציבורית", { location_permission: true, access_note_he: "פתוח" })).status).toBe(400)
  })
})
