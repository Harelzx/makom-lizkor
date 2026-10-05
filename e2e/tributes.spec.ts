import { expect, test, type Browser, type Page } from "@playwright/test"

const DAY = { timeout: 20_000 }

/** A contribution published through the API: Cloudflare's dummy token passes the development test secret. */
async function published(browser: Browser, name: string) {
  const ctx = await browser.newContext()
  const res = await ctx.request.post("/api/v1/submissions", {
    headers: { "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""), "Turnstile-Token": "XXXX.DUMMY.TOKEN.XXXX" },
    data: { kind: "garden", name_he: name, lat: 31.4234, lng: 34.4987, consent_version: "notice.submission@2026-10-9" },
  })
  const { id } = (await res.json()) as { id: string }
  await ctx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const { items } = (await (await ctx.request.get("/api/admin/queue")).json()) as {
    items: { id: string; rev: number; revisionId: string }[]
  }
  const item = items.find((i) => i.id === id)!
  await ctx.request.post(`/api/admin/places/${id}/transitions`, {
    headers: { "Sec-Fetch-Site": "same-origin" },
    data: { action: "approve", revisionId: item.revisionId, expectedRev: item.rev },
  })
  return id
}

async function open(browser: Browser, id: string, init?: string) {
  const page = await (await browser.newContext()).newPage()
  if (init) await page.addInitScript(init)
  const posts: string[] = []
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/v1/tributes")) posts.push(r.headers()["idempotency-key"])
  })
  await page.goto(`/#/place/${id}`)
  await expect(page.getByRole("button", { name: "השארת כלנית" })).toBeVisible(DAY)
  return { page, posts }
}
const total = async (page: Page, id: string) =>
  ((await (await page.request.get("/api/v1/tributes")).json()) as { totals: Record<string, number> }).totals[id] ?? 0

test("ten taps at a published place: ten flowers here, one anemone counted for everyone", async ({ browser }) => {
  const id = await published(browser, `גינת דמו כלניות ${Date.now()}`)
  const { page, posts } = await open(browser, id)
  const counted = page.waitForResponse((r) => r.url().endsWith("/api/v1/tributes") && r.request().method() === "POST")
  for (let i = 0; i < 10; i++) await page.getByRole("button", { name: "השארת כלנית" }).click()
  await counted
  await expect(page.getByText("השארתם כאן 10 כלניות")).toBeVisible()
  await expect(page.getByText("השאירו כאן כלנית אחת")).toBeVisible()
  await page.waitForTimeout(1000)
  expect(posts).toHaveLength(1)
  // Another browser sees the shared count.
  const other = await open(browser, id)
  await expect(other.page.getByText("השאירו כאן כלנית אחת")).toBeVisible(DAY)
})

test("an anemone whose answer was lost is sent again under the same key and counted once", async ({ browser }) => {
  const id = await published(browser, `גינת דמו כלנית אבדה ${Date.now()}`)
  const { page, posts } = await open(browser, id)
  let lost = false
  await page.route("**/api/v1/tributes", async (route) => {
    if (route.request().method() !== "POST" || lost) return route.continue()
    lost = true
    await route.fetch()
    await route.abort("failed")
  })
  await page.getByRole("button", { name: "השארת כלנית" }).click()
  await expect.poll(() => posts.length).toBe(1)
  await page.waitForTimeout(500)
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await expect.poll(() => posts.length).toBe(2)
  expect(posts[1]).toBe(posts[0])
  await expect.poll(() => total(page, id)).toBe(1)
})

test("a browser that can't store anything keeps its flowers here and sends nothing", async ({ browser }) => {
  const id = await published(browser, `גינת דמו בלי אחסון ${Date.now()}`)
  const { page, posts } = await open(browser, id, "indexedDB.open = () => { throw new DOMException('blocked', 'SecurityError') }")
  await page.getByRole("button", { name: "השארת כלנית" }).click()
  await expect(page.getByText("השארתם כאן כלנית אחת")).toBeVisible()
  await expect(page.getByText("נשמר רק במכשיר הזה")).toBeVisible()
  await page.waitForTimeout(1500)
  expect(posts).toHaveLength(0)
})

test("at one of the site's own places the flowers stay on this device, and say so", async ({ browser }) => {
  const { page, posts } = await open(browser, "nova-memorial-reim")
  await page.getByRole("button", { name: "השארת כלנית" }).click()
  await expect(page.getByText("השארתם כאן כלנית אחת")).toBeVisible()
  await expect(page.getByText("נשמר רק במכשיר הזה")).toBeVisible()
  await page.waitForTimeout(1500)
  expect(posts).toHaveLength(0)
})

test("an anemone that waited more than seven days unsent is dropped, not counted", async ({ browser }) => {
  const id = await published(browser, `גינת דמו כלנית ישנה ${Date.now()}`)
  const { page, posts } = await open(browser, id)
  await page.evaluate(
    ([placeId]) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("makom-lizkor-v2")
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const tx = req.result.transaction("v1", "readwrite")
          tx.objectStore("v1").put({ [placeId]: { key: "0".repeat(32), at: Date.now() - 8 * 24 * 3600 * 1000 } }, "tributeOutbox")
          tx.oncomplete = () => resolve()
        }
      }),
    [id],
  )
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await page.waitForTimeout(1500)
  expect(posts).toHaveLength(0)
  expect(await total(page, id)).toBe(0)
})
