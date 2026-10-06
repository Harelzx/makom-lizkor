import { expect, test, type Page } from "@playwright/test"
import { audit } from "./axe"

async function day(page: Page) {
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג" }).click()
  await page.locator("#places").waitFor()
  await page.waitForTimeout(1500)
}

test.describe("desktop", () => {
  test("the opening's choice of sound", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("button", { name: "בלי צליל" })).toBeVisible()
    await audit(page)
  })

  test("the map and the list, by day and by night", async ({ page }) => {
    await day(page)
    await audit(page)
    await page.getByRole("button", { name: "מעבר למצב לילה" }).click()
    await page.waitForTimeout(1200)
    await audit(page)
  })

  test("a place with a gallery", async ({ page }) => {
    await page.goto("/#/place/nova-memorial-reim")
    await expect(page.getByRole("heading", { name: "אתר ההנצחה לנרצחי פסטיבל נובה" })).toBeVisible()
    await page.waitForTimeout(1500)
    await audit(page)
  })

  test("About, with every section open", async ({ page }) => {
    await day(page)
    await page.getByRole("button", { name: "על הפרויקט" }).click()
    const sheet = page.getByRole("dialog")
    await expect(sheet).toBeVisible()
    for (const trigger of await sheet.locator('[data-slot="accordion-trigger"]').all()) await trigger.click()
    await page.waitForTimeout(600)
    await audit(page)
  })

  test("search", async ({ page }) => {
    await day(page)
    await page.getByRole("button", { name: /חיפוש מקום או קהילה/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    // the field is announced by name, not just as "combobox"
    await expect(page.getByRole("combobox", { name: "חיפוש מקום, יישוב או פעולה" })).toBeVisible()
    await audit(page)
  })

  test("adding a place, every step", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"])
    await context.setGeolocation({ latitude: 31.39, longitude: 34.47 })
    await day(page)
    await page.getByRole("button", { name: "הוספת מקום", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: /איפה המקום/ })
    await expect(dialog).toBeVisible()
    // contrast is measured on the settled dialog, not halfway through its fade
    await page.waitForTimeout(800)
    await audit(page)
    await dialog.getByRole("button", { name: "המיקום הנוכחי שלי" }).click()
    // The location arrives asynchronously and grows the form; pressing on before it would land where the button was.
    await expect(dialog.getByText("סומן מיקום", { exact: false })).toBeVisible({ timeout: 15_000 })
    await page.getByRole("button", { name: "המשך" }).click()
    await expect(page.getByRole("dialog", { name: /מה יש שם/ })).toBeVisible()
    await page.waitForTimeout(500)
    await audit(page)
    await page.getByLabel("שם המקום").fill("ספסל לבדיקה")
    await page.getByRole("button", { name: "המשך" }).click()
    await expect(page.getByRole("dialog", { name: /לפני שמוסיפים/ })).toBeVisible()
    await page.waitForTimeout(500)
    await audit(page)
  })

  test("after the opening, a keyboard starts at the skip button, and it lands in the list", async ({ page, browserName }) => {
    // Safari's Tab skips buttons and links unless the visitor turns that on; Option+Tab is how its keyboard users move
    const tab = browserName === "webkit" ? "Alt+Tab" : "Tab"
    // a keyboard visitor skips the opening with Esc, and the focus waits at the top of the page
    await page.goto("/")
    // the opening hands the keyboard its choice of sound; Esc from there skips the film
    const choice = page.getByRole("button", { name: "בלי צליל" })
    await expect(choice).toBeVisible()
    await choice.focus()
    await page.keyboard.press("Escape")
    await page.locator("#places").waitFor()
    const skip = page.getByRole("button", { name: "דילוג לרשימת המקומות" })
    await expect(skip).toBeFocused()
    await expect(skip).toBeInViewport()
    await page.keyboard.press("Enter")
    await expect(page.locator("#places")).toBeFocused()
    // the next stops are inside the panel, not more flowers on the map, and each one shows where the focus is
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press(tab)
      const stop = await page.evaluate(() => {
        const a = document.activeElement!
        const cs = getComputedStyle(a)
        return {
          name: (a.getAttribute("aria-label") ?? a.textContent ?? "").trim().slice(0, 30),
          inPanel: !!a.closest("#places"),
          ring: cs.outlineStyle !== "none" || cs.boxShadow !== "none",
        }
      })
      expect(stop, stop.name).toMatchObject({ inPanel: true, ring: true })
    }
  })

  test("the gallery takes focus, moves with the arrows, and names its dots", async ({ page }) => {
    await page.goto("/#/place/nova-memorial-reim")
    const strip = page.getByRole("group", { name: /תמונות. אפשר לעבור ביניהן בחיצים/ })
    await strip.waitFor()
    await page.waitForTimeout(1500)
    await strip.focus()
    await expect(strip).toBeFocused()
    const before = await strip.evaluate((e) => e.scrollLeft)
    await page.keyboard.press("ArrowLeft")
    await expect.poll(() => strip.evaluate((e) => e.scrollLeft)).not.toBe(before)
    await expect(page.getByRole("button", { name: /^תמונה 2 מתוך \d+$/ })).toHaveAttribute("aria-current", "true")
  })

  test("the statement, privacy notice and terms open from under the list too, at their own section", async ({ page }) => {
    await day(page)
    const links = page.getByRole("navigation", { name: "מידע על האתר" })
    for (const [label, id] of [
      ["הצהרת נגישות", "accessibility"],
      ["פרטיות", "privacy"],
      ["תנאי שימוש", "terms"],
    ]) {
      await links.getByRole("button", { name: label }).click()
      const trigger = page.locator(`#${id} [data-slot="accordion-trigger"]`)
      await expect(trigger).toHaveAttribute("aria-expanded", "true")
      await expect(trigger).toBeFocused()
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toBeHidden()
    }
  })

  test("text alone at 200% wraps the top buttons instead of covering the panel", async ({ page }) => {
    await day(page)
    await page.addStyleTag({ content: "html{font-size:200% !important}" })
    await page.waitForTimeout(600)
    const panel = (await page.locator("#places").boundingBox())!
    const search = (await page.getByRole("button", { name: /חיפוש מקום או קהילה/ }).boundingBox())!
    // RTL: the panel is on the right, so the buttons must end before it begins
    expect(search.x + search.width).toBeLessThanOrEqual(panel.x)
  })
})
