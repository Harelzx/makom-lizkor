import { test, expect, type Page } from "./fixtures"
import { readFileSync } from "node:fs"
const demo = JSON.parse(readFileSync(new URL("../fixtures/ux-preview.json", import.meta.url), "utf8")) as {
  id: string
  summary_he: string
}[]
import { audit } from "./axe"

test.use({ reducedMotion: "reduce", geolocation: { latitude: 31.42, longitude: 34.51 }, permissions: ["geolocation"] })
async function feed(page: Page) {
  await page.route("**/api/v1/version", (r) => r.fulfill({ json: { v: "0.99999" } }))
  await page.route("**/api/v1/feed?*", (r) => r.fulfill({ json: { v: "0.99999", places: demo } }))
}
async function day(page: Page) {
  await feed(page)
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await expect(page.locator("#places")).toBeVisible({ timeout: 20_000 })
}
async function confirm(page: Page) {
  await page.getByRole("button", { name: "הוספת מקום", exact: true }).first().click()
  const form = page.getByRole("dialog")
  await form.getByRole("button", { name: "המיקום הנוכחי שלי", exact: true }).click()
  await expect(form.getByText("סומן מיקום", { exact: false })).toBeVisible()
  await form.getByRole("button", { name: "המשך", exact: true }).click()
  await form.getByLabel("שם המקום", { exact: true }).fill("ספסל בדיקת ממשק")
  await form.getByLabel("לזכר (לא חובה)").fill("שם לדוגמה")
  await form.getByLabel("כמה מילים על המקום (לא חובה)").fill("סיפור לדוגמה שנבדק לפני השליחה.")
  await form.getByRole("button", { name: "המשך", exact: true }).click()
  await expect(form.getByRole("checkbox")).toHaveCount(2)
  for (const checkbox of await form.getByRole("checkbox").all()) await checkbox.check()
  return form
}

test("both searches find a name that appears only in the dedication; empty search has a clear route back", async ({ page }) => {
  await day(page)
  await page.getByRole("searchbox", { name: "חיפוש", exact: true }).fill("נועה")
  await expect(page.locator("#places").getByRole("button", { name: /הספסל מול השדות/ })).toBeVisible()
  await page.getByRole("button", { name: /^חיפוש מקום/ }).click()
  await page.getByRole("combobox").fill("נועה")
  await expect(page.getByRole("option", { name: /הספסל מול השדות/ })).toBeVisible()
  await page.getByRole("combobox").fill("בלתי נמצא בכלל")
  await expect(page.getByRole("button", { name: "ניקוי החיפוש", exact: true })).toBeVisible()
  await audit(page)
  await page.getByRole("button", { name: "ניקוי החיפוש", exact: true }).click()
  await expect(page.getByRole("combobox")).toHaveValue("")
})

test("saved visits survive reload, and a place no longer published is not resurrected by its saved id", async ({ page }) => {
  await feed(page)
  await page.goto("/#/place/p_preview_bench")
  await page.getByRole("button", { name: "שמירה לביקור", exact: true }).click()
  await expect(page.getByRole("button", { name: "שמור לביקור", exact: true })).toHaveAttribute("aria-pressed", "true")
  await page.reload()
  await expect(page.getByRole("button", { name: "שמור לביקור", exact: true })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "כל המקומות", exact: true }).click()
  await page.getByRole("button", { name: "שמורים לביקור", exact: true }).click()
  await expect(page.locator("#places").getByRole("button", { name: /הספסל מול השדות/ })).toBeVisible()
  await page.route("**/api/v1/version", (r) => r.fulfill({ json: { v: "0.100000" } }))
  await page.route("**/api/v1/feed?*", (r) => r.fulfill({ json: { v: "0.100000", places: [] } }))
  const refreshed = page.waitForResponse((r) => r.url().includes("/api/v1/feed?") && r.status() === 200)
  await page.reload()
  await refreshed
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await page.getByRole("button", { name: "שמורים לביקור", exact: true }).click()
  await expect(page.getByText("עוד אין כאן מקום שמור לביקור", { exact: true })).toBeVisible()
  await expect(page.locator("#places").getByRole("button", { name: /הספסל מול השדות/ })).toHaveCount(0)
})

for (const width of [320, 390])
  test(`visible mobile controls, readable story and stable form footer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await day(page)
    await page.getByRole("button", { name: "הצגת המקומות", exact: true }).click()
    const mark = page.getByRole("link", { name: "מקום לזכור, חזרה למפה" })
    const header = page.locator("header").first()
    const rect = await header.boundingBox()
    expect(rect!.x).toBeGreaterThanOrEqual(0)
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width)
    const brand = await mark.boundingBox()
    const info = await page.getByRole("button", { name: "על הפרויקט", exact: true }).boundingBox()
    expect(info!.x + info!.width).toBeLessThanOrEqual(brand!.x)
    await expect(mark).toBeInViewport()
    await page
      .locator("#places")
      .getByRole("button", { name: /הספסל מול השדות/ })
      .click()
    await expect(page.getByText(demo[0].summary_he, { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "שמירה לביקור", exact: true }).scrollIntoViewIfNeeded()
    await expect(page.getByRole("button", { name: "שמירה לביקור", exact: true })).toBeInViewport()
    await page.getByRole("button", { name: "חזרה למפה", exact: true }).click()
    await page.getByRole("button", { name: "הוספת מקום", exact: true }).click()
    const form = page.getByRole("dialog")
    await expect(form.getByText("בלי הרשמה. המייל לא חובה. ההצעה תתפרסם אחרי בדיקה.", { exact: true })).toBeVisible()
    await form.getByRole("button", { name: "המיקום הנוכחי שלי", exact: true }).click()
    await expect(form.getByText("סומן מיקום", { exact: false })).toBeVisible()
    await form.getByRole("button", { name: "המשך", exact: true }).click()
    await form.getByRole("button", { name: "המשך", exact: true }).click()
    await expect(form.getByLabel("שם המקום", { exact: true })).toBeFocused()
    await expect(form.getByRole("alert").filter({ hasText: "כתבו איך נקרא המקום" })).toBeVisible()
    // A keyboard reduces the visible viewport while the layout viewport can stay tall (iOS).
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 460 })
      window.visualViewport!.dispatchEvent(new Event("resize"))
    })
    await form.getByLabel("שם המקום", { exact: true }).fill("ספסל בדיקת סיכום")
    const nextButton = form.getByRole("button", { name: "המשך", exact: true })
    await expect
      .poll(async () => {
        const box = await nextButton.boundingBox()
        return box!.y + box!.height
      })
      .toBeLessThanOrEqual(460)
    await page.evaluate(() => {
      Reflect.deleteProperty(window.visualViewport!, "height")
      window.visualViewport!.dispatchEvent(new Event("resize"))
    })
    await form.getByLabel("כמה מילים על המקום (לא חובה)").fill("הסיפור שהמבקר יבדוק בשלב האחרון.")
    await expect(form.getByRole("button", { name: "המשך", exact: true })).toBeInViewport()
    await form.getByRole("button", { name: "המשך", exact: true }).click()
    await expect(form.getByRole("region", { name: "סיכום ההצעה" })).toContainText("הסיפור שהמבקר יבדוק בשלב האחרון.")
    await expect(form.getByRole("button", { name: "שליחה לבדיקה", exact: true })).toBeInViewport()
    await audit(page)
    await form.getByRole("button", { name: "עריכת הפרטים", exact: true }).click()
    await expect(form.getByLabel("שם המקום", { exact: true })).toHaveValue("ספסל בדיקת סיכום")
  })

for (const scenario of [
  { code: 201, title: "תודה שהוספתם מקום לזכור", data: { id: "p_preview_sent", trackingToken: "test_tracking_token" } },
  { code: 503, title: "לא הצלחנו לאשר את השליחה", data: { code: "unavailable" } },
  { code: 400, title: "ההצעה לא התקבלה", data: { code: "invalid_input" } },
])
  test(`submission feedback matches the actual ${scenario.code} answer`, async ({ page }) => {
    await day(page)
    await page.route("**/api/v1/submissions", (r) => r.fulfill({ status: scenario.code, json: scenario.data }))
    const form = await confirm(page)
    await form.getByRole("button", { name: "שליחה לבדיקה", exact: true }).click()
    await expect(page.getByRole("heading", { name: scenario.title, exact: true })).toBeVisible()
    await expect(page.getByText("הכלנית במקומה", { exact: true })).toHaveCount(0)
    if (scenario.code !== 201) await expect(page.locator('[aria-hidden="true"] > span.size-20')).toHaveCount(0)
    if (scenario.code === 201) {
      await audit(page)
      await page.getByRole("button", { name: "לצפייה בהצעה", exact: true }).click()
      await page.getByRole("button", { name: "מחיקת העותק מהמכשיר", exact: true }).click()
      await expect(page.getByRole("alertdialog")).toContainText("ההצעה שכבר נשלחה תישאר במערכת")
      await expect(page.getByRole("button", { name: "למעקב ולמשיכת ההצעה", exact: true })).toBeVisible()
      await audit(page)
      await page.keyboard.press("Escape")
      await expect(page.getByRole("alertdialog")).toBeHidden()
      await expect(page.getByRole("button", { name: "מעקב אחרי ההצעה", exact: true })).toBeVisible()
    } else {
      await expect(page.getByRole("dialog")).toContainText("לא נשמרה במכשיר")
      await page.getByRole("button", { name: "סגירה ללא שמירה", exact: true }).click()
      await expect(page.getByRole("heading", { name: "ספסל בדיקת ממשק", exact: true })).toHaveCount(0)
      await page.getByRole("button", { name: "הוספת מקום", exact: true }).first().click()
      await expect(page.getByRole("heading", { name: "איפה המקום?", exact: true })).toBeVisible()
    }
  })

for (const width of [320, 390])
  test(`normal-motion mobile card footer is reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await feed(page)
    await page.goto("/#/place/p_preview_bench")
    const request = page.getByRole("button", { name: "בקשת הסרה או תיקון", exact: true })
    await request.scrollIntoViewIfNeeded()
    await expect(request).toBeInViewport({ ratio: 1 })
    await request.click({ timeout: 5000 })
    const cancel = page.getByRole("region", { name: "בקשת הסרה או תיקון", exact: true }).getByRole("button", { name: "ביטול", exact: true })
    await cancel.scrollIntoViewIfNeeded()
    await expect(cancel).toBeInViewport({ ratio: 1 })
    await cancel.click()
    await page.getByRole("button", { name: "כל המקומות", exact: true }).click()
    await page.getByRole("button", { name: "חזרה למפה", exact: true }).click()
    const privacy = page.locator("#places").getByRole("button", { name: "פרטיות", exact: true })
    await privacy.scrollIntoViewIfNeeded()
    await expect(privacy).toBeInViewport({ ratio: 1 })
    await privacy.click({ timeout: 5000 })
    await expect(page.getByRole("heading", { name: "פרטיות", exact: true })).toBeVisible()
  })
