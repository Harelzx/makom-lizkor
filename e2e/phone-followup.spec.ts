import { readFileSync } from "node:fs"
import { test, expect, type Page } from "./fixtures"
import { audit } from "./axe"

const demo = JSON.parse(readFileSync(new URL("../fixtures/ux-preview.json", import.meta.url), "utf8"))
test.use({
  viewport: { width: 390, height: 844 },
  reducedMotion: "reduce",
  geolocation: { latitude: 31.42, longitude: 34.51 },
  permissions: ["geolocation"],
})

async function day(page: Page) {
  await page.route("**/api/v1/version", (r) => r.fulfill({ json: { v: "0.99999" } }))
  await page.route("**/api/v1/feed?*", (r) => r.fulfill({ json: { v: "0.99999", places: demo } }))
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await expect(page.getByRole("button", { name: "הוספת מקום", exact: true }).first()).toBeVisible({ timeout: 20000 })
}

async function details(page: Page) {
  await page.getByRole("button", { name: "הוספת מקום", exact: true }).first().click()
  const form = page.locator('[data-slot="dialog-content"][data-state="open"]')
  await expect(form).toBeVisible()
  // Refresh the mocked provider before requesting a fix. Replacing it while a request is already pending can
  // deliver POSITION_UNAVAILABLE to that request, especially when this test opens a second proposal.
  await page.context().setGeolocation({ latitude: 31.42, longitude: 34.51 })
  await form.getByRole("button", { name: "המיקום הנוכחי שלי", exact: true }).click()
  await expect(form.getByText("סומן מיקום", { exact: false })).toBeVisible()
  return form
}

async function confirm(page: Page) {
  const form = await details(page)
  await form.getByRole("button", { name: "המשך", exact: true }).click()
  await form.getByLabel("שם המקום", { exact: true }).fill("ספסל בדיקת טלפון")
  await form.getByRole("button", { name: "המשך", exact: true }).click()
  for (const box of await form.getByRole("checkbox").all()) await box.check()
  return form
}

async function storedCount(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("makom-lizkor-v2")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const read = db.transaction("v1").objectStore("v1").get("local")
          read.onerror = () => {
            db.close()
            reject(read.error)
          }
          read.onsuccess = () => {
            db.close()
            resolve((read.result ?? []).length)
          }
        }
      }),
  )
}

test("cold flower transition keeps a decoded image visible until the next artwork is ready", async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>((r) => {
    release = r
  })
  await page.route("**/art/anemone-watercolor.webp", async (route) => {
    await gate
    await route.continue()
  })
  try {
    await day(page)
    await page.emulateMedia({ reducedMotion: "no-preference" })
    const form = await details(page)
    await expect
      .poll(() => form.locator("img[data-add-art]").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true)
    await form.getByRole("button", { name: "המשך", exact: true }).click()
    // Intentionally hold the new bitmap beyond the outgoing animation: reproduce the real cold-load blank frame.
    await page.waitForTimeout(250)
    const visibleLoaded = () =>
      form.locator("img[src^='/art/']").evaluateAll((imgs) =>
        imgs.some((el) => {
          const img = el as HTMLImageElement
          return img.complete && img.naturalWidth > 0 && Number(getComputedStyle(img).opacity) > 0.2
        }),
      )
    expect(await visibleLoaded()).toBe(true)
    release()
    await expect(form.locator("[data-add-art]")).toHaveAttribute("src", "/art/anemone-watercolor.webp")
    await expect.poll(visibleLoaded).toBe(true)
    await form.getByRole("button", { name: "חזרה", exact: true }).click()
    await expect(form.locator("[data-add-art]")).toHaveAttribute("src", "/art/bud.webp")
  } finally {
    release()
  }
})

test("every fast retry announces its new result and uses the same request without saving failures", async ({ page }) => {
  const sent: { key: string; body: string }[] = []
  await page.route("**/api/v1/submissions", async (r) => {
    sent.push({ key: r.request().headers()["idempotency-key"], body: r.request().postData()! })
    await r.fulfill({ status: 503, json: { code: "unavailable" } })
  })
  await day(page)
  const form = await confirm(page)
  await form.getByRole("button", { name: "שליחה לבדיקה", exact: true }).click()
  const result = page.locator("[data-submission-result]")
  await expect(result.getByRole("status")).toContainText("ניסיון 1")
  await expect(result.getByRole("status")).toContainText("ללא אישור קבלה")
  for (const n of [2, 3]) {
    await result.getByRole("button", { name: "ניסיון שליחה נוסף", exact: true }).click()
    await expect(result.getByRole("status")).toContainText(`ניסיון ${n}`)
    await expect(result.getByRole("button", { name: "שולחים לבדיקה…", exact: true })).toBeDisabled()
    await expect(result.getByRole("status")).toContainText(`ניסיון ${n} הסתיים ללא אישור קבלה`)
    await expect(result.getByRole("button", { name: "ניסיון שליחה נוסף", exact: true })).toBeEnabled()
  }
  expect(sent).toHaveLength(3)
  expect(new Set(sent.map((r) => r.key)).size).toBe(1)
  expect(new Set(sent.map((r) => r.body)).size).toBe(1)
  expect(await storedCount(page)).toBe(0)
  await audit(page)
  await result.getByRole("button", { name: "סגירה ללא שמירה", exact: true }).click()
  await page.getByRole("button", { name: "הוספת מקום", exact: true }).first().click()
  await expect(page.getByRole("heading", { name: "איפה המקום?", exact: true })).toBeVisible()
})

for (const width of [320, 390])
  test(`mobile sheet at ${width}px shows only its actions until opened and restores map space`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await day(page)
    const sheet = page.locator("#places")
    const sheetBox = await sheet.boundingBox()
    expect(844 - sheetBox!.y).toBeLessThanOrEqual(120)
    await expect(page.getByRole("heading", { name: "מקומות לזכור", exact: true })).toHaveCount(0)
    const open = sheet.getByRole("button", { name: "הצגת המקומות", exact: true })
    await expect(open).toBeInViewport({ ratio: 1 })
    await expect(sheet.getByRole("button", { name: "הוספת מקום", exact: true })).toBeInViewport({ ratio: 1 })
    await open.click()
    await expect(sheet.getByRole("heading", { name: "מקומות לזכור", exact: true })).toBeInViewport()
    await expect(sheet.getByRole("button", { name: "שמורים לביקור", exact: true })).toBeInViewport()
    await audit(page)
    await sheet.getByRole("button", { name: "חזרה למפה", exact: true }).click()
    await expect(sheet.getByRole("heading", { name: "מקומות לזכור", exact: true })).toHaveCount(0)
    // Browser chrome chooses its own size, but the page must no longer paint a dark background in day mode.
    const colors = await page.evaluate(() => [
      getComputedStyle(document.body).backgroundColor,
      document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
    ])
    expect(colors).toEqual(["rgb(255, 255, 255)", "#ffffff"])
  })

test("retry can succeed, while a refusal returns to editing rather than offering endless retries", async ({ page }) => {
  let count = 0
  await page.route("**/api/v1/submissions", (r) => {
    count++
    return r.fulfill(
      count === 1
        ? { status: 503, json: { code: "unavailable" } }
        : { status: 201, json: { id: "p_phone_retry", trackingToken: "synthetic_tracking_only" } },
    )
  })
  await day(page)
  const form = await confirm(page)
  await form.getByRole("button", { name: "שליחה לבדיקה", exact: true }).click()
  await page.getByRole("button", { name: "ניסיון שליחה נוסף", exact: true }).click()
  await expect(page.getByRole("heading", { name: "תודה שהוספתם מקום לזכור", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "לצפייה בהצעה", exact: true })).toBeEnabled()
  expect(await storedCount(page)).toBe(1)
  await page.getByRole("button", { name: "לצפייה בהצעה", exact: true }).click()
  await page.unroute("**/api/v1/submissions")
  await page.route("**/api/v1/submissions", (r) => r.fulfill({ status: 400, json: { code: "invalid_input" } }))
  const another = await confirm(page)
  await another.getByRole("button", { name: "שליחה לבדיקה", exact: true }).click()
  await expect(page.getByRole("heading", { name: "ההצעה לא התקבלה", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "ניסיון שליחה נוסף", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "חזרה לטופס", exact: true }).click()
  await expect(page.getByRole("heading", { name: "לפני שמוסיפים", exact: true })).toBeVisible()
  expect(await storedCount(page)).toBe(1)
})

test("the folded sheet opens by a keyboard skip or an upward drag", async ({ page }) => {
  await day(page)
  const sheet = page.locator("#places")
  await expect(sheet.getByRole("button", { name: "הצגת המקומות", exact: true })).toBeInViewport({ ratio: 1 })
  // Vaul intentionally ignores drag for 500ms after opening/settling at its highest snap.
  // Exercise the initial settled sheet, not an immediate close-and-drag inside that guard.
  await page.waitForTimeout(550)
  const grip = sheet.locator("[data-sheet-grip]")
  const box = await grip.boundingBox()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.evaluate(() => new Promise<number>(requestAnimationFrame))
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + ((250 - box!.y - box!.height / 2) * i) / 12)
  }
  await page.mouse.up()
  await expect(sheet.getByRole("heading", { name: "מקומות לזכור", exact: true })).toBeInViewport()
  await sheet.getByRole("button", { name: "חזרה למפה", exact: true }).click()
  const skip = page.getByRole("button", { name: "דילוג לרשימת המקומות", exact: true })
  await skip.focus()
  await skip.press("Enter")
  await expect(sheet.getByRole("heading", { name: "מקומות לזכור", exact: true })).toBeInViewport()
})

test("a rate limit disables retry until its deadline, then a lost response is visibly uncertain", async ({ page }) => {
  let requests = 0
  await page.route("**/api/v1/submissions", (r) => {
    requests++
    return requests === 1 ? r.fulfill({ status: 429, headers: { "Retry-After": "2" }, json: { code: "rate_limited" } }) : r.abort("failed")
  })
  await day(page)
  const form = await confirm(page)
  await form.getByRole("button", { name: "שליחה לבדיקה", exact: true }).click()
  const retry = page.getByRole("button", { name: "ניסיון שליחה נוסף", exact: true })
  await expect(retry).toBeDisabled()
  await expect(page.getByRole("dialog")).toContainText("אפשר לנסות שוב בעוד")
  await expect(retry).toBeEnabled({ timeout: 5000 })
  await retry.click()
  await expect(page.getByRole("status")).toContainText("ניסיון 2 הסתיים ללא אישור קבלה")
  await expect(page.getByRole("dialog")).toContainText("ייתכן שההצעה כבר הגיעה")
  expect(await storedCount(page)).toBe(0)
  expect(requests).toBe(2)
})
