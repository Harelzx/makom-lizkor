import { expect, test, type APIRequestContext, type Browser } from "@playwright/test"

const DAY = { timeout: 20_000 }

/** A published place made through the API: Cloudflare's dummy token passes the development test secret. */
async function published(browser: Browser, name: string, extra: Record<string, unknown> = {}) {
  const ctx = await browser.newContext()
  const api: APIRequestContext = ctx.request
  const res = await api.post("/api/v1/submissions", {
    headers: { "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""), "Turnstile-Token": "XXXX.DUMMY.TOKEN.XXXX" },
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
  const ctx = await browser.newContext()
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
  const ctx = await browser.newContext()
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
