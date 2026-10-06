import { expect, test, type APIRequestContext, type Browser } from "@playwright/test"
import { from, ownAddress } from "./publish"

// The opening isn't what this file tests, and its sunrise took about 8 s on every page that went through it. A visitor
// who asked for less motion gets the day at once, with every flow the same; the opening keeps its own full-motion
// specs (three-years, sound, montage, panel).
test.use({ reducedMotion: "reduce" })

const DAY = { timeout: 20_000 }

/** A published place made through the API: Cloudflare's dummy token passes the development test secret. */
async function published(browser: Browser, name: string, extra: Record<string, unknown> = {}) {
  const ctx = await ownAddress(await browser.newContext())
  const api: APIRequestContext = ctx.request
  const res = await api.post("/api/v1/submissions", {
    headers: from(ctx, { "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""), "Turnstile-Token": "XXXX.DUMMY.TOKEN.XXXX" }),
    data: { kind: "garden", name_he: name, lat: 31.423456, lng: 34.498765, consent_version: "notice.submission@2026-10-9", ...extra },
  })
  expect(res.status()).toBe(201)
  const { id } = (await res.json()) as { id: string }
  await api.post("/__dev/login", { data: { email: "dev@example.test" } })
  const { items } = (await (await api.get("/api/admin/queue")).json()) as { items: { id: string; rev: number; revisionId: string }[] }
  const item = items.find((i) => i.id === id)!
  const ok = await api.post(`/api/admin/places/${id}/transitions`, {
    headers: { "Sec-Fetch-Site": "same-origin" },
    data: { action: "approve", revisionId: item.revisionId, expectedRev: item.rev },
  })
  expect(ok.status()).toBe(200)
  return id
}

test("a family's place on private property is shown approximately, with no way to navigate to it", async ({ browser }) => {
  const name = `גינת דמו בחצר ${Date.now()}`
  const id = await published(browser, name, { on_private_property: true })
  const page = await (await browser.newContext()).newPage()
  await page.goto(`/#/place/${id}`)
  await expect(page.getByRole("heading", { name })).toBeVisible(DAY)
  await expect(page.getByText("המיקום משוער", { exact: false })).toBeVisible()
  await expect(page.getByRole("link", { name: /Waze/ })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Google Maps" })).toHaveCount(0)
  await expect(page.getByText("31.42000, 34.50000")).toBeVisible()
})

test("after one visit, the approved places are there with no connection, from the last snapshot", async ({ browser }) => {
  const name = `ספסל דמו לאופליין ${Date.now()}`
  await published(browser, name)
  const ctx = await ownAddress(await browser.newContext())
  const page = await ctx.newPage()
  const fed = page.waitForResponse((r) => r.url().includes("/api/v1/feed?") && r.status() === 200)
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await fed
  await page.waitForTimeout(500)

  // Now the server can't be reached at all.
  await page.route("**/api/**", (r) => r.abort())
  await page.reload()
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await expect(page.getByRole("button", { name: /^חיפוש מקום/ })).toBeVisible(DAY)
  await page.getByRole("button", { name: /^חיפוש מקום/ }).click()
  await page.getByRole("dialog").getByRole("combobox").fill(name)
  await expect(page.getByRole("option", { name: new RegExp(name) })).toBeVisible()
})

test("a link to a newly approved place opens it even when this browser holds an older offline copy", async ({ browser }) => {
  const ctx = await ownAddress(await browser.newContext())
  const page = await ctx.newPage()
  // A first visit leaves a snapshot that doesn't have the new place yet.
  const fed = page.waitForResponse((r) => r.url().includes("/api/v1/feed?") && r.status() === 200)
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await fed
  await page.waitForTimeout(500)

  const name = `ספסל דמו חדש מהקישור ${Date.now()}`
  const id = await published(browser, name)
  // The live feed is slow to come; the old snapshot is there at once.
  await page.route("**/api/v1/feed?*", async (r) => {
    await new Promise((done) => setTimeout(done, 2500))
    await r.continue()
  })
  await page.goto(`/#/place/${id}`)
  await page.reload()
  await expect(page.getByRole("heading", { name })).toBeVisible(DAY)
  await expect(page).toHaveURL(new RegExp(`#/place/${id}$`))
})

test("a link to a place that isn't published falls back even when the offline copy is already current", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  const fed = page.waitForResponse((r) => r.url().includes("/api/v1/feed?") && r.status() === 200)
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await fed
  await page.waitForTimeout(500)
  // Same version on the server as in the snapshot: the live check finds nothing newer to fetch.
  await page.goto("/#/place/p_01ZZZZZZZZZZZZZZZZZZZZZZZZ")
  await page.reload()
  await expect(page).toHaveURL(/#\/$/, DAY)
})

test("the moderator sees that a place is on private property, the owner's permission, and the access note, before approving", async ({
  browser,
}) => {
  const name = `גינת דמו באישור הבעלים ${Date.now()}`
  const note = "הכניסה דרך השער הצפוני, בתיאום מראש עם המשפחה"
  const ctx = await ownAddress(await browser.newContext())
  const res = await ctx.request.post("/api/v1/submissions", {
    headers: from(ctx, { "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""), "Turnstile-Token": "XXXX.DUMMY.TOKEN.XXXX" }),
    data: {
      kind: "garden",
      name_he: name,
      lat: 31.423456,
      lng: 34.498765,
      on_private_property: true,
      location_permission: true,
      access_note_he: note,
      consent_version: "notice.submission@2026-10-9",
    },
  })
  expect(res.status()).toBe(201)
  await ctx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const mod = await ctx.newPage()
  await mod.goto("/admin/")
  const item = mod.getByRole("article", { name })
  await expect(item.getByText("במקום פרטי, במיקום מדויק באישור הבעלים")).toBeVisible()
  await expect(item.getByText(note)).toBeVisible()
})

test("the moderator sees that a place on private property without the owner's permission will be shown approximately", async ({
  browser,
}) => {
  const name = `גינת דמו בלי אישור ${Date.now()}`
  const ctx = await ownAddress(await browser.newContext())
  const res = await ctx.request.post("/api/v1/submissions", {
    headers: from(ctx, { "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""), "Turnstile-Token": "XXXX.DUMMY.TOKEN.XXXX" }),
    data: {
      kind: "garden",
      name_he: name,
      lat: 31.423456,
      lng: 34.498765,
      on_private_property: true,
      consent_version: "notice.submission@2026-10-9",
    },
  })
  expect(res.status()).toBe(201)
  await ctx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const mod = await ctx.newPage()
  await mod.goto("/admin/")
  const item = mod.getByRole("article", { name })
  await expect(item.getByText("במקום פרטי, בלי אישור הבעלים: יוצג מיקום משוער")).toBeVisible()
  await expect(item.getByText("איך מגיעים", { exact: false })).toHaveCount(0)
})
