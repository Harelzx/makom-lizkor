import { expect, test, type Browser, type BrowserContextOptions, type Page } from "./fixtures"
import { from, ownAddress } from "./publish"

// The opening isn't what this file tests, and its sunrise took about 8 s on every page that went through it. A visitor
// who asked for less motion gets the day at once, with every flow the same; the opening keeps its own full-motion
// specs (three-years, sound, montage, panel).
test.use({ reducedMotion: "reduce" })

const DAY = { timeout: 20_000 }
const GEO: BrowserContextOptions = { geolocation: { latitude: 31.42, longitude: 34.49 }, permissions: ["geolocation"] }

async function day(b: Browser, init?: string) {
  const page = await (await ownAddress(await b.newContext(GEO))).newPage()
  if (init) await page.addInitScript(init)
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await expect(page.getByRole("button", { name: /^חיפוש מקום/ })).toBeVisible(DAY)
  return page
}

async function fillAndSave(page: Page, name: string) {
  await page.getByRole("button", { name: "הוספת מקום" }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "המיקום הנוכחי שלי" }).click()
  // The location arrives asynchronously and grows the form; pressing on before it would land where the button was.
  await expect(dialog.getByText("סומן מיקום", { exact: false })).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole("button", { name: "המשך" }).click()
  await dialog.getByLabel("שם המקום").fill(name)
  await dialog.getByRole("button", { name: "המשך" }).click()
  // The last step has two boxes (family, consent); wait for the step before it to finish leaving, or a box of
  // the leaving step is collected and never comes back.
  await expect(dialog.getByRole("checkbox")).toHaveCount(2)
  for (const box of await dialog.getByRole("checkbox").all()) await box.check()
  await dialog.getByRole("button", { name: "שמירה והנחת כלנית" }).click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
}

async function queued(b: Browser, name: string) {
  const ctx = await b.newContext()
  await ctx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const { items } = (await (await ctx.request.get("/api/admin/queue")).json()) as { items: { name_he: string }[] }
  return items.filter((i) => i.name_he === name).length
}

test("an answer lost after the server saved is retried as the same place, once", async ({ browser }) => {
  const name = `ספסל דמו אבד ${Date.now()}`
  const page = await day(browser)
  const keys: string[] = []
  let first = true
  await page.route("**/api/v1/submissions", async (route) => {
    keys.push(route.request().headers()["idempotency-key"])
    if (!first) return route.continue({ headers: from(page.context(), route.request().headers()) })
    first = false
    await route.fetch({ headers: from(page.context(), route.request().headers()) }) // the server saves it…
    await route.abort("failed") // …and the answer never arrives
  })
  await fillAndSave(page, name)
  await expect(page.getByText("ננסה שוב לבד", { exact: false }).first()).toBeVisible()
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await expect(page.getByText("נשלח לבדיקה, ויופיע לכולם אחרי אישור.")).toBeVisible({ timeout: 10_000 })
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(await queued(browser, name)).toBe(1)
})

test("a submission the server refuses says so, keeps the place, and isn't sent again", async ({ browser }) => {
  const page = await day(browser)
  let posts = 0
  await page.route("**/api/v1/submissions", (route) => {
    posts++
    return route.fulfill({
      status: 400,
      contentType: "application/problem+json",
      body: JSON.stringify({ status: 400, code: "invalid_input" }),
    })
  })
  await fillAndSave(page, `ספסל דמו נדחה ${Date.now()}`)
  await expect(page.getByText("ההצעה לא התקבלה", { exact: false }).first()).toBeVisible()
  // A resend would first fetch a fresh Turnstile token (a few seconds), so give it time to show itself.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await page.waitForTimeout(8000)
  expect(posts).toBe(1)
  // the form works again: the button isn't stuck
  await page.getByRole("button", { name: "הוספת מקום" }).first().click()
  await expect(page.getByRole("dialog")).toBeVisible()
})

test("when the browser can't store anything, the site opens and the place is still sent", async ({ browser }) => {
  const name = `ספסל דמו בלי אחסון ${Date.now()}`
  const page = await day(browser, "indexedDB.open = () => { throw new DOMException('blocked', 'SecurityError') }")
  await fillAndSave(page, name)
  await expect(page.getByText("לא הצלחנו לשמור עותק במכשיר הזה", { exact: false })).toBeVisible()
  expect(await queued(browser, name)).toBe(1)
})

test("a place whose sending was cut off by closing the tab is sent on the next visit", async ({ browser }) => {
  const name = `ספסל דמו נסגר ${Date.now()}`
  const ctx = await ownAddress(await browser.newContext(GEO))
  const page = await ctx.newPage()
  await page.route("**/api/v1/submissions", () => new Promise(() => {})) // never answers
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await expect(page.getByRole("button", { name: /^חיפוש מקום/ })).toBeVisible(DAY)
  await page.getByRole("button", { name: "הוספת מקום" }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "המיקום הנוכחי שלי" }).click()
  // The location arrives asynchronously and grows the form; pressing on before it would land where the button was.
  await expect(dialog.getByText("סומן מיקום", { exact: false })).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole("button", { name: "המשך" }).click()
  await dialog.getByLabel("שם המקום").fill(name)
  await dialog.getByRole("button", { name: "המשך" }).click()
  // The last step has two boxes (family, consent); wait for the step before it to finish leaving, or a box of
  // the leaving step is collected and never comes back.
  await expect(dialog.getByRole("checkbox")).toHaveCount(2)
  for (const box of await dialog.getByRole("checkbox").all()) await box.check()
  await dialog.getByRole("button", { name: "שמירה והנחת כלנית" }).click()
  await page.waitForTimeout(500)
  await page.close()
  // The next visit sends it once the day begins, as the feed does: nothing reaches the network during the opening.
  const next = await ctx.newPage()
  await next.goto("/")
  await next.getByRole("button", { name: "דילוג", exact: true }).click()
  await expect.poll(() => queued(browser, name), { timeout: 20_000 }).toBe(1)
})

test("a full review queue stops the form politely, keeps the place, and waits before sending again", async ({ browser }) => {
  // A visit, a form with a bot check, and an 8 s watch for a resend: past the 30 s default on a busy machine.
  test.setTimeout(60_000)
  const page = await day(browser)
  let posts = 0
  await page.route("**/api/v1/submissions", (route) => {
    posts++
    return route.fulfill({
      status: 503,
      headers: { "Retry-After": "3600" },
      contentType: "application/problem+json",
      body: JSON.stringify({ status: 503, code: "queue_full" }),
    })
  })
  await fillAndSave(page, `ספסל דמו תור מלא ${Date.now()}`)
  await expect(page.getByText("יותר הצעות ממה שאפשר לבדוק", { exact: false }).first()).toBeVisible()
  // A resend would first fetch a fresh Turnstile token (a few seconds), so give it time to show itself.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await page.waitForTimeout(8000)
  expect(posts).toBe(1)
})

/** What this browser has stored of the visitor's own places: name, the key it is sent under, and its tracking token. */
const stored = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ name: string; key?: string; token?: string }[]>((resolve, reject) => {
        const open = indexedDB.open("makom-lizkor-v2")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const get = open.result.transaction("v1").objectStore("v1").get("local")
          get.onsuccess = () =>
            resolve(
              ((get.result ?? []) as { name_he: string; local?: { submitKey?: string; trackingToken?: string } }[]).map((p) => ({
                name: p.name_he,
                key: p.local?.submitKey,
                token: p.local?.trackingToken,
              })),
            )
        }
      }),
  )

test("two tabs adding places at once keep each other's places, keys and tracking links", async ({ browser }) => {
  // Two visits, two forms and four Turnstile runs: measured 28.6–32.3 s on the production build, past the 30 s default.
  test.setTimeout(90_000)
  const stamp = Date.now()
  const [x, y] = [`ספסל דמו לשונית א ${stamp}`, `ספסל דמו לשונית ב ${stamp}`]
  const ctx = await ownAddress(await browser.newContext(GEO))
  // Both tabs open before either adds anything, so neither has the other's place in memory.
  const tabs = await Promise.all([ctx.newPage(), ctx.newPage()])
  for (const tab of tabs) {
    // The first answer is lost after the server saved it, in both tabs.
    let lost = false
    await tab.route("**/api/v1/submissions", async (route) => {
      if (lost) return route.continue({ headers: from(tab.context(), route.request().headers()) })
      lost = true
      await route.fetch({ headers: from(tab.context(), route.request().headers()) })
      await route.abort("failed")
    })
    await tab.goto("/")
    await tab.getByRole("button", { name: "דילוג", exact: true }).click()
    await expect(tab.getByRole("button", { name: /^חיפוש מקום/ })).toBeVisible(DAY)
  }
  await fillAndSave(tabs[0], x)
  await fillAndSave(tabs[1], y)
  const afterBoth = await stored(tabs[0])
  expect(afterBoth.map((p) => p.name)).toEqual(expect.arrayContaining([x, y]))
  // Each place is still there with what it needs: its key while waiting, or its tracking link if an early wake of
  // the outbox has already sent it (the key is dropped once a place is answered).
  for (const name of [x, y]) {
    const p = afterBoth.find((q) => q.name === name)!
    expect(p.key || p.token, name).toBeTruthy()
  }

  // Each tab retries; the retries land, and each tab records what it learned without dropping the other's.
  for (const tab of tabs) await tab.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await expect
    .poll(async () => (await stored(tabs[1])).filter((p) => (p.name === x || p.name === y) && p.token).length, { timeout: 20_000 })
    .toBe(2)
  const tokens = Object.fromEntries((await stored(tabs[1])).map((p) => [p.name, p.token]))
  await tabs[0].reload()
  const after = await stored(tabs[0])
  for (const name of [x, y]) {
    expect(after.filter((p) => p.name === name)).toHaveLength(1)
    // Each keeps the tracking link its own retry learned; the key, no longer needed once sent, is dropped.
    expect(after.find((p) => p.name === name)!.token).toBe(tokens[name])
    expect(after.find((p) => p.name === name)!.key).toBeUndefined()
  }
  expect(await queued(browser, x)).toBe(1)
  expect(await queued(browser, y)).toBe(1)
})
