import { expect, test, type Browser, type BrowserContextOptions, type Page } from "./fixtures"
import { from, ownAddress } from "./publish"

test.use({ reducedMotion: "reduce" })
const DAY = { timeout: 20_000 }
const GEO: BrowserContextOptions = { geolocation: { latitude: 31.42, longitude: 34.49 }, permissions: ["geolocation"] }
const receipt = (page: Page) => page.getByRole("heading", { name: "תודה שהוספתם מקום לזכור", exact: true })
async function acknowledge(page: Page) {
  await expect(receipt(page)).toBeVisible(DAY)
  await page.getByRole("button", { name: "לצפייה בהצעה", exact: true }).click()
}
async function day(b: Browser, init?: string) {
  const page = await (await ownAddress(await b.newContext(GEO))).newPage()
  if (init) await page.addInitScript(init)
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await expect(page.getByRole("button", { name: /^חיפוש מקום/ })).toBeVisible(DAY)
  return page
}
async function fillAndSend(page: Page, name: string) {
  await page.getByRole("button", { name: "הוספת מקום" }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "המיקום הנוכחי שלי" }).click()
  await page.getByRole("button", { name: "זה המקום", exact: true }).click({ timeout: 15_000 })
  await expect(dialog.getByText("סומן מיקום", { exact: false })).toBeVisible(DAY)
  await dialog.getByRole("button", { name: "המשך" }).click()
  await dialog.getByLabel("שם המקום").fill(name)
  await dialog.getByRole("button", { name: "המשך" }).click()
  await expect(dialog.getByRole("checkbox")).toHaveCount(2)
  for (const box of await dialog.getByRole("checkbox").all()) await box.check()
  await dialog.getByRole("button", { name: "שליחה לבדיקה" }).click()
}
async function queued(b: Browser, name: string) {
  const ctx = await b.newContext()
  try {
    await ctx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
    const { items } = (await (await ctx.request.get("/api/admin/queue")).json()) as { items: { name_he: string }[] }
    return items.filter((i) => i.name_he === name).length
  } finally {
    await ctx.close()
  }
}
const stored = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ name: string; key?: string; token?: string }[]>((resolve, reject) => {
        const open = indexedDB.open("makom-lizkor-v2")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const read = db.transaction("v1").objectStore("v1").get("local")
          read.onsuccess = () => {
            resolve(
              ((read.result ?? []) as { name_he: string; local?: { submitKey?: string; trackingToken?: string } }[]).map((p) => ({
                name: p.name_he,
                key: p.local?.submitKey,
                token: p.local?.trackingToken,
              })),
            )
            db.close()
          }
        }
      }),
  )

test(
  "a lost receipt is not stored, and a manual retry recovers the same server submission once",
  { tag: "@core-lost-receipt" },
  async ({ browser }) => {
    const name = `ספסל דמו אבד ${Date.now()}`
    const page = await day(browser)
    const keys: string[] = []
    const bodies: string[] = []
    await page.route("**/api/v1/submissions", async (route) => {
      keys.push(route.request().headers()["idempotency-key"])
      bodies.push(route.request().postData()!)
      if (keys.length > 1) return route.continue({ headers: from(page.context(), route.request().headers()) })
      await route.fetch({ headers: from(page.context(), route.request().headers()) })
      await route.abort("failed")
    })
    await fillAndSend(page, name)
    await expect(page.getByRole("heading", { name: "לא הצלחנו לאשר את השליחה", exact: true })).toBeVisible(DAY)
    expect(await stored(page)).toEqual([])
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
    await page.getByRole("button", { name: "ניסיון שליחה נוסף", exact: true }).click()
    await acknowledge(page)
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
    expect(bodies[1]).toBe(bodies[0])
    expect(await queued(browser, name)).toBe(1)
    const rows = await stored(page)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name, token: expect.any(String) })
    expect(rows[0].key).toBeUndefined()
  },
)

test("a refusal leaves no stored place and a closed form forgets its values", async ({ browser }) => {
  const page = await day(browser)
  let posts = 0
  await page.route("**/api/v1/submissions", (r) => {
    posts++
    return r.fulfill({ status: 400, json: { code: "invalid_input" } })
  })
  await fillAndSend(page, `ספסל דמו נדחה ${Date.now()}`)
  await expect(page.getByRole("heading", { name: "ההצעה לא התקבלה", exact: true })).toBeVisible(DAY)
  expect(await stored(page)).toEqual([])
  await page.getByRole("button", { name: "סגירה ללא שמירה", exact: true }).click()
  // Back again after the morning, so straight to the day.
  await page.reload()
  await expect(page.getByRole("button", { name: /^חיפוש מקום/ })).toBeVisible(DAY)
  expect(posts).toBe(1)
  expect(await stored(page)).toEqual([])
  await page.getByRole("button", { name: "הוספת מקום" }).first().click()
  await expect(page.getByRole("heading", { name: "איפה המקום?", exact: true })).toBeVisible()
})

test("blocked browser storage does not prevent receipt, and the warning stays until acknowledged", async ({ browser }) => {
  const name = `ספסל דמו בלי אחסון ${Date.now()}`
  const page = await day(browser, "indexedDB.open = () => { throw new DOMException('blocked', 'SecurityError') }")
  await fillAndSend(page, name)
  await expect(receipt(page)).toBeVisible(DAY)
  await expect(page.getByRole("dialog")).toContainText("לא הצלחנו לשמור את קישור המעקב במכשיר")
  expect(await queued(browser, name)).toBe(1)
  await acknowledge(page)
  await expect(page.getByRole("button", { name: "מעקב אחרי ההצעה", exact: true })).toBeVisible()
})

for (const delivery of ["cancelled-before-close", "accepted-response-lost"] as const)
  test(`a ${delivery} submission stores nothing and never resends after closing the tab`, async ({ browser }) => {
    const name = `ספסל דמו נסגר ${delivery} ${Date.now()}`
    const page = await day(browser)
    const context = page.context()
    let started!: () => void
    let release!: () => void
    const request = new Promise<void>((r) => (started = r))
    const gate = new Promise<void>((r) => (release = r))
    let handled: Promise<void> | undefined
    let intercepted: import("@playwright/test").Request | undefined
    let posts = 0
    await context.route("**/api/v1/submissions", (route) => {
      posts++
      // An unexpected resend must fail the count, without leaving another request hanging.
      if (posts > 1) return route.abort("failed")
      intercepted = route.request()
      handled = (async () => {
        if (delivery === "accepted-response-lost") {
          const response = await route.fetch({ headers: from(context, route.request().headers()) })
          expect(response.status()).toBe(201)
        }
        started()
        await gate
        // Cancellation is a barrier only while the target is alive. Errors there must fail the test.
        try {
          await route.abort("failed")
        } catch (error) {
          // The accepted request is already on the server; after close this is only handler cleanup.
          if (!page.isClosed() || !/Target.*closed|has been closed/i.test(String(error))) throw error
        }
      })()
      return handled
    })
    try {
      await fillAndSend(page, name)
      await request
      expect(await stored(page)).toEqual([])
      if (delivery === "cancelled-before-close") {
        const failed = page.waitForEvent("requestfailed", { predicate: (r) => r === intercepted })
        release()
        await handled
        await failed
        await expect(page.getByRole("heading", { name: "לא הצלחנו לאשר את השליחה", exact: true })).toBeVisible(DAY)
        expect(await queued(browser, name)).toBe(0)
      }
      // This case does not claim that closing an arbitrary in-flight POST prevents server delivery.
      await page.close()
      release()
      await handled
      const next = await context.newPage()
      // The cached feed is still current: syncing reads the version but correctly skips downloading it again.
      const sync = next.waitForResponse((r) => r.url().endsWith("/api/v1/version") && r.ok())
      // This browser has been to the morning, so the new tab opens in the day.
      await next.goto("/")
      await expect(next.getByRole("button", { name: /^חיפוש מקום/ })).toBeVisible(DAY)
      await sync
      expect(await stored(next)).toEqual([])
      expect(posts).toBe(1)
      expect(await queued(browser, name)).toBe(delivery === "accepted-response-lost" ? 1 : 0)
    } finally {
      release()
      // Preserve the original failure, but settle the intercepted request during teardown.
      await handled?.catch(() => {})
    }
  })

test("a full queue leaves no local place and respects the server's wait before manual retry", async ({ browser }) => {
  const page = await day(browser)
  let posts = 0
  await page.route("**/api/v1/submissions", (r) => {
    posts++
    return r.fulfill({ status: 503, headers: { "Retry-After": "3600" }, json: { code: "queue_full" } })
  })
  await fillAndSend(page, `ספסל דמו תור מלא ${Date.now()}`)
  await expect(page.getByRole("dialog")).toContainText("יותר הצעות ממה שאפשר לבדוק", DAY)
  expect(await stored(page)).toEqual([])
  await expect(page.getByRole("button", { name: "ניסיון שליחה נוסף", exact: true })).toBeDisabled()
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await page.getByRole("button", { name: "סגירה ללא שמירה", exact: true }).click()
  await page.getByRole("button", { name: "הוספת מקום" }).first().click()
  await expect(page.getByRole("heading", { name: "איפה המקום?", exact: true })).toBeVisible()
  expect(posts).toBe(1)
})

test("two tabs retain only confirmed tracking copies and keep each other's accepted records", async ({ browser }) => {
  test.setTimeout(90_000)
  const stamp = Date.now()
  const names = [`ספסל דמו לשונית א ${stamp}`, `ספסל דמו לשונית ב ${stamp}`]
  const ctx = await ownAddress(await browser.newContext(GEO))
  const tabs = await Promise.all([ctx.newPage(), ctx.newPage()])
  for (const tab of tabs) {
    let lost = false
    await tab.route("**/api/v1/submissions", async (r) => {
      if (lost) return r.continue({ headers: from(tab.context(), r.request().headers()) })
      lost = true
      await r.fetch({ headers: from(tab.context(), r.request().headers()) })
      await r.abort("failed")
    })
    await tab.goto("/")
    // One browser: once the first tab has been to the morning, the second opens in the day.
    if (tab === tabs[0]) await tab.getByRole("button", { name: "דילוג", exact: true }).click()
    await expect(tab.getByRole("button", { name: /^חיפוש מקום/ })).toBeVisible(DAY)
  }
  for (const [i, tab] of tabs.entries()) {
    await fillAndSend(tab, names[i])
    await expect(tab.getByRole("heading", { name: "לא הצלחנו לאשר את השליחה", exact: true })).toBeVisible(DAY)
  }
  expect(await stored(tabs[0])).toEqual([])
  for (const tab of tabs) {
    await tab.getByRole("button", { name: "ניסיון שליחה נוסף", exact: true }).click()
    await acknowledge(tab)
  }
  const records = await stored(tabs[0])
  for (const name of names) {
    expect(records.filter((p) => p.name === name)).toHaveLength(1)
    expect(records.find((p) => p.name === name)?.token).toBeTruthy()
    expect(await queued(browser, name)).toBe(1)
  }
  await tabs[0].reload()
  expect(await stored(tabs[0])).toEqual(records)
})
