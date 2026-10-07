import { env } from "cloudflare:workers"
import { SignJWT } from "jose"
import { describe, expect, it } from "vitest"
import { MACHINE_ACTOR, machineModerator } from "../lib/access"
import { SYNTHETIC_MARK, syntheticPlace } from "../lib/synthetic"
import { call } from "./app"
import { approve, submit } from "./helpers"

// Staging's synthetic machine moderator (Harel's approval H1, 7 October 2026): one service token, staging only, that
// may approve, publish, hide and lift synthetic places and nothing else. The deployment's own token and the read-only
// diagnostics token never moderate, and production refuses it whatever its config says.

const MACHINE = "dev-staging-moderator.access"
const serviceToken = (commonName: string) =>
  new SignJWT({ common_name: commonName, type: "app" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("dev-access")
    .setAudience("makom-dev")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.DEV_ACCESS_SECRET))
const as = async (commonName: string, path: string, init: RequestInit = {}, e: Env = env) =>
  call(
    `http://local${path}`,
    {
      ...init,
      headers: {
        "Cf-Access-Jwt-Assertion": await serviceToken(commonName),
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
        "Sec-Fetch-Site": "same-origin",
        ...init.headers,
      },
    },
    e,
  )
const machine = (path: string, init: RequestInit = {}, e: Env = env) => as(MACHINE, path, init, e)
type Item = { id: string; rev: number; revisionId: string }
const queue = async () => (await (await machine("/api/admin/queue")).json<{ items: Item[] }>()).items
const rev = async (id: string) => (await env.DB.prepare("SELECT rev FROM places WHERE id = ?").bind(id).first<number>("rev"))!
const hide = (id: string, expectedRev: number) =>
  machine("/api/admin/suppressions", {
    method: "POST",
    body: JSON.stringify({ placeId: id, fields: ["whole"], expectedRev, reason: "בדיקת הסרה על מקום סינתטי" }),
  })
const LIFT = {
  basisCode: "hidden_in_error",
  basisNote: "הסתרה של בדיקה על מקום סינתטי.",
  confirm: { affirmativeBasis: true, notNonresponseOrDispute: true },
}
const synthetic = () => submit(`${SYNTHETIC_MARK}ספסל בדיקה ${crypto.randomUUID().slice(0, 8)}`)

describe("which tokens moderate", () => {
  const e = (over: Partial<Env>) => ({ ...env, MODERATOR_SERVICE_TOKENS: MACHINE, OPS_SERVICE_TOKENS: "dev-ops.access", ...over })
  it("a listed token in staging, or locally in development, and never in production", () => {
    expect(machineModerator(MACHINE, e({ ENVIRONMENT: "staging" }))).toBe(true)
    expect(machineModerator(MACHINE, e({ ENVIRONMENT: "development" }))).toBe(true)
    expect(machineModerator(MACHINE, e({ ENVIRONMENT: "production" }))).toBe(false)
    expect(machineModerator(MACHINE, e({ ENVIRONMENT: "" }))).toBe(false)
  })
  it("never a token that isn't listed, an empty id, or one that is also the diagnostics' read-only token", () => {
    expect(machineModerator("ci-deploy.access", e({ ENVIRONMENT: "staging" }))).toBe(false)
    expect(machineModerator("", e({ ENVIRONMENT: "staging", MODERATOR_SERVICE_TOKENS: "" }))).toBe(false)
    expect(machineModerator(MACHINE, e({ ENVIRONMENT: "staging", OPS_SERVICE_TOKENS: `dev-ops.access,${MACHINE}` }))).toBe(false)
  })
  it("the deployment's own token and the diagnostics token are refused by the moderators' routes", async () => {
    for (const id of ["ci-deploy.access", "dev-ops.access"]) {
      expect((await as(id, "/api/admin/queue")).status).toBe(403)
      expect((await as(id, "/api/admin/suppressions", { method: "POST", body: "{}" })).status).toBe(403)
    }
  })
})

describe("what the machine moderator may do", () => {
  it("sees only synthetic places in the queue, and approves one: published, with a machine actor on record", async () => {
    const s = await synthetic()
    const real = await submit("ספסל דמו שאינו סינתטי")
    const items = await queue()
    expect(items.some((i) => i.id === s.id)).toBe(true)
    expect(items.some((i) => i.id === real.id)).toBe(false)
    const item = items.find((i) => i.id === s.id)!
    const res = await machine(`/api/admin/places/${s.id}/transitions`, {
      method: "POST",
      body: JSON.stringify({ action: "approve", revisionId: item.revisionId, expectedRev: item.rev }),
    })
    expect(res.status).toBe(200)
    expect(await env.DB.prepare("SELECT status FROM places WHERE id = ?").bind(s.id).first<string>("status")).toBe("published")
    expect((await machine(`/api/admin/places/${s.id}`)).status).toBe(200)
  })

  it("hides a published synthetic place whole and lifts its own hide, each recorded as the machine", async () => {
    const s = await synthetic()
    const item = (await queue()).find((i) => i.id === s.id)!
    await machine(`/api/admin/places/${s.id}/transitions`, {
      method: "POST",
      body: JSON.stringify({ action: "approve", revisionId: item.revisionId, expectedRev: item.rev }),
    })
    expect((await hide(s.id, await rev(s.id))).status).toBe(200)
    const sid = await env.DB.prepare("SELECT id FROM field_suppressions WHERE place_id = ? AND lifted_at IS NULL")
      .bind(s.id)
      .first<string>("id")
    const lifted = await machine(`/api/admin/suppressions/${sid}/lift`, {
      method: "POST",
      body: JSON.stringify({ ...LIFT, expectedRev: await rev(s.id) }),
    })
    expect(lifted.status).toBe(200)
    const actors = await env.DB.prepare("SELECT action, actor FROM audit_log WHERE entity_id = ? ORDER BY at, id")
      .bind(s.id)
      .all<{ action: string; actor: string }>()
    expect(actors.results.filter((a) => a.action === "manual_hide" || a.action === "lift").map((a) => a.actor)).toEqual([
      MACHINE_ACTOR,
      MACHINE_ACTOR,
    ])
  })

  it("is refused on a place that isn't synthetic: its view, its approval, a hide, and a lift of a person's hide", async () => {
    const real = await submit("ספסל דמו אמיתי לבדיקת סירוב")
    expect((await machine(`/api/admin/places/${real.id}`)).status).toBe(403)
    const pending = await env.DB.prepare("SELECT id FROM revisions WHERE place_id = ?").bind(real.id).first<string>("id")
    expect(
      (
        await machine(`/api/admin/places/${real.id}/transitions`, {
          method: "POST",
          body: JSON.stringify({ action: "approve", revisionId: pending, expectedRev: await rev(real.id) }),
        })
      ).status,
    ).toBe(403)
    expect(await env.DB.prepare("SELECT status FROM places WHERE id = ?").bind(real.id).first<string>("status")).not.toBe("published")
    expect((await approve(real.id)).status).toBe(200)
    expect((await hide(real.id, await rev(real.id))).status).toBe(403)
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM field_suppressions WHERE place_id = ?").bind(real.id).first<number>("n")).toBe(0)
  })

  it("is refused everything else a moderator can do: the site's own places, reports, contacts, the attention list, media", async () => {
    for (const [method, path] of [
      ["POST", "/api/admin/places"],
      ["POST", "/api/admin/curated-photos"],
      ["GET", "/api/admin/reports"],
      ["GET", "/api/admin/reports/r_x/contact"],
      ["GET", "/api/admin/attention"],
      ["GET", "/api/admin/media/public/x.webp"],
      ["GET", "/api/admin/places/car-wall-tkuma"],
    ])
      expect((await machine(path, { method, ...(method === "POST" ? { body: "{}" } : {}) })).status, `${method} ${path}`).toBe(403)
  })

  it("a place is synthetic only when every name it was sent under carries the mark, and never one of the site's own", async () => {
    const s = await synthetic()
    expect(await syntheticPlace(env.DB, s.id)).toBe(true)
    // A later revision without the mark makes the whole place a real one's.
    const first = await env.DB.prepare("SELECT * FROM revisions WHERE place_id = ?").bind(s.id).first<Record<string, unknown>>()
    const cols = Object.keys(first!)
    const copy = { ...first, id: `${first!.id}x`, n: Number(first!.n) + 1, name_he: "ספסל דמו בלי סימון" }
    await env.DB.prepare(`INSERT INTO revisions (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
      .bind(...cols.map((c) => (copy as Record<string, unknown>)[c] ?? null))
      .run()
    expect(await syntheticPlace(env.DB, s.id)).toBe(false)
    expect(await syntheticPlace(env.DB, "car-wall-tkuma")).toBe(false)
  })
})

// H1-SYNTHETIC-RACE-1: a correction without the mark landing between the machine's check and its use. The database
// is the test's own, wrapped so that `between` runs once, right after the check's statement is read.
const interleaved = (between: () => Promise<void>): Env => {
  let ran = false
  const pass = <T extends object>(o: T, p: string | symbol) => {
    const v = Reflect.get(o, p)
    return typeof v === "function" ? v.bind(o) : v
  }
  const db = new Proxy(env.DB, {
    get(target, prop) {
      if (prop !== "prepare") return pass(target, prop)
      return (sql: string) => {
        const stmt = target.prepare(sql)
        if (!sql.includes("AS marked")) return stmt
        return new Proxy(stmt, {
          get(s, p) {
            if (p !== "bind") return pass(s, p)
            return (...args: unknown[]) =>
              new Proxy(s.bind(...args), {
                get(b, q) {
                  if (q !== "first") return pass(b, q)
                  return async (...a: [string?]) => {
                    const row = await b.first(...(a as []))
                    if (!ran) {
                      ran = true
                      await between()
                    }
                    return row
                  }
                },
              })
          },
        })
      }
    },
  })
  return { ...env, DB: db as D1Database }
}
/** A correction as the submitter's route makes one: a new revision, here without the mark, and the place's rev on. */
const unmarkedCorrection = (id: string) => async () => {
  const last = await env.DB.prepare("SELECT * FROM revisions WHERE place_id = ? ORDER BY n DESC LIMIT 1")
    .bind(id)
    .first<Record<string, unknown>>()
  const cols = Object.keys(last!)
  const copy = { ...last, id: `${last!.id}c`, n: Number(last!.n) + 1, state: "pending", name_he: "ספסל דמו שתוקן בלי סימון" }
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO revisions (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(
      ...cols.map((c) => (copy as Record<string, unknown>)[c] ?? null),
    ),
    env.DB.prepare("UPDATE places SET rev = rev + 1 WHERE id = ?").bind(id),
  ])
}
const published = async () => {
  const s = await synthetic()
  const item = (await queue()).find((i) => i.id === s.id)!
  await machine(`/api/admin/places/${s.id}/transitions`, {
    method: "POST",
    body: JSON.stringify({ action: "approve", revisionId: item.revisionId, expectedRev: item.rev }),
  })
  return s.id
}
const suppressions = async (id: string) =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM field_suppressions WHERE place_id = ? AND lifted_at IS NULL")
    .bind(id)
    .first<number>("n"))!

describe("a correction between the machine's check and its use (H1-SYNTHETIC-RACE-1)", () => {
  it("can't let it hide the place, whether it names the rev it saw or the one after", async () => {
    for (const ahead of [0, 1]) {
      const id = await published()
      const seen = await rev(id)
      const res = await machine(
        "/api/admin/suppressions",
        { method: "POST", body: JSON.stringify({ placeId: id, fields: ["whole"], expectedRev: seen + ahead, reason: "בדיקת מרוץ" }) },
        interleaved(unmarkedCorrection(id)),
      )
      expect([403, 409], `ahead ${ahead}`).toContain(res.status)
      expect(await suppressions(id), `ahead ${ahead}`).toBe(0)
    }
  })

  it("can't let it approve, whether it names the rev it saw or the one after", async () => {
    for (const ahead of [0, 1]) {
      const s = await synthetic()
      const item = (await queue()).find((i) => i.id === s.id)!
      const res = await machine(
        `/api/admin/places/${s.id}/transitions`,
        { method: "POST", body: JSON.stringify({ action: "approve", revisionId: item.revisionId, expectedRev: item.rev + ahead }) },
        interleaved(unmarkedCorrection(s.id)),
      )
      expect([403, 409], `ahead ${ahead}`).toContain(res.status)
      expect(await env.DB.prepare("SELECT status FROM places WHERE id = ?").bind(s.id).first<string>("status")).not.toBe("published")
    }
  })

  it("can't let it lift a hide, whether it names the rev it saw or the one after", async () => {
    for (const ahead of [0, 1]) {
      const id = await published()
      expect((await hide(id, await rev(id))).status).toBe(200)
      const sid = await env.DB.prepare("SELECT id FROM field_suppressions WHERE place_id = ? AND lifted_at IS NULL")
        .bind(id)
        .first<string>("id")
      const seen = await rev(id)
      const res = await machine(
        `/api/admin/suppressions/${sid}/lift`,
        { method: "POST", body: JSON.stringify({ ...LIFT, expectedRev: seen + ahead }) },
        interleaved(unmarkedCorrection(id)),
      )
      expect([403, 409], `ahead ${ahead}`).toContain(res.status)
      expect(await suppressions(id), `ahead ${ahead}`).toBe(1)
    }
  })

  it("can't let it read the changed place: the view is refused, and says nothing of it", async () => {
    const id = await published()
    const res = await machine(`/api/admin/places/${id}`, {}, interleaved(unmarkedCorrection(id)))
    expect(res.status).toBe(409)
    expect(await res.text()).not.toContain("בלי סימון")
  })

  it("leaves a place out of the queue once a correction without the mark is in", async () => {
    const s = await synthetic()
    await unmarkedCorrection(s.id)()
    expect((await queue()).some((i) => i.id === s.id)).toBe(false)
  })
})
