import { readFileSync } from "node:fs"
import { test, expect, type Page } from "./fixtures"
import { audit } from "./axe"

const demo = JSON.parse(readFileSync(new URL("../fixtures/ux-preview.json", import.meta.url), "utf8"))
test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" })

async function openForm(page: Page, mode: "silent" | "denied" | "unavailable" | "insecure" | "unsupported" = "silent") {
  await page.addInitScript((mode) => {
    Object.defineProperty(window, "isSecureContext", { value: mode !== "insecure", configurable: true })
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value:
        mode === "unsupported"
          ? undefined
          : {
              getCurrentPosition(success: PositionCallback, error: PositionErrorCallback) {
                const root = document.documentElement
                root.dataset.locationCalls = String(Number(root.dataset.locationCalls || 0) + 1)
                window.addEventListener(
                  "test:location",
                  () => success({ coords: { latitude: 31.42, longitude: 34.51 } } as GeolocationPosition),
                  { once: true },
                )
                if (mode === "denied" || mode === "unavailable")
                  setTimeout(() => error({ code: mode === "denied" ? 1 : 2 } as GeolocationPositionError), 150)
              },
            },
    })
  }, mode)
  await page.route("**/api/v1/version", (r) => r.fulfill({ json: { v: "0.99999" } }))
  await page.route("**/api/v1/feed?*", (r) => r.fulfill({ json: { v: "0.99999", places: demo } }))
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await page.getByRole("button", { name: "הוספת מקום", exact: true }).first().click()
  const form = page.locator('[data-slot="dialog-content"][data-state="open"]')
  await expect(form).toBeVisible()
  return form
}

for (const [mode, explanation] of [
  ["insecure", "החיבור אינו מאובטח"],
  ["unsupported", "לא תומך"],
  ["denied", "הגישה למיקום חסומה"],
  ["unavailable", "לא הצליח לקבוע"],
] as const)
  test(`${mode} location has visible inline feedback and a usable manual fallback`, async ({ page }) => {
    const form = await openForm(page, mode)
    await form.getByRole("button", { name: "המיקום הנוכחי שלי", exact: true }).click()
    const status = form.locator("[data-location-status]")
    await expect(status).toContainText(explanation)
    await expect(status).toBeInViewport({ ratio: 1 })
    await expect(form.getByRole("button", { name: "המיקום הנוכחי שלי", exact: true })).toBeEnabled()
    await audit(page)
    if (mode === "insecure" || mode === "unsupported") await expect(page.locator("html")).not.toHaveAttribute("data-location-calls")
    await form.getByRole("button", { name: "סימון על המפה", exact: true }).click()
    await expect(page.getByText("לחצו על המפה במקום המדויק", { exact: true })).toBeVisible()
  })

test("a silent GPS has a loading state, a deadline, repeat feedback and no late pin", { tag: ["@phone"] }, async ({ page }) => {
  const form = await openForm(page)
  // The dialog's opening motion has to settle first: with the clock frozen mid-spring, the button never counts as
  // stable and the click waits out the test (seen on a slow WebKit runner, 14 October).
  await form.getByRole("button", { name: "המיקום הנוכחי שלי", exact: true }).click({ trial: true })
  await page.clock.install()
  for (const count of [1, 2]) {
    await form.getByRole("button", { name: "המיקום הנוכחי שלי", exact: true }).click()
    await expect(form.getByRole("button", { name: "מאתרים מיקום…", exact: true })).toBeDisabled()
    await expect(form.locator("[data-location-status]")).toContainText("ממתינים למיקום")
    await expect(page.locator("html")).toHaveAttribute("data-location-calls", String(count))
    await page.clock.runFor(12500)
    await expect(form.locator("[data-location-status]")).toContainText("יותר מדי זמן")
    await expect(form.getByRole("button", { name: "המיקום הנוכחי שלי", exact: true })).toBeEnabled()
  }
  await page.evaluate(() => window.dispatchEvent(new Event("test:location")))
  await expect(form.getByText("סומן מיקום", { exact: false })).toHaveCount(0)
})

test("closing and map selection cancel GPS, while a successful retry marks a pin", async ({ page }) => {
  let form = await openForm(page)
  await form.getByRole("button", { name: "המיקום הנוכחי שלי", exact: true }).click()
  await form.getByRole("button", { name: "סגירה", exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event("test:location")))
  await page.getByRole("button", { name: "הוספת מקום", exact: true }).first().click()
  form = page.locator('[data-slot="dialog-content"][data-state="open"]')
  await expect(form.getByText("סומן מיקום", { exact: false })).toHaveCount(0)
  await form.getByRole("button", { name: "המיקום הנוכחי שלי", exact: true }).click()
  await form.getByRole("button", { name: "סימון על המפה", exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event("test:location")))
  await expect(page.getByText("לחצו על המפה במקום המדויק", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "ביטול", exact: true }).click()
  await form.getByRole("button", { name: "המיקום הנוכחי שלי", exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event("test:location")))
  await page.getByRole("button", { name: "זה המקום", exact: true }).click({ timeout: 15_000 })
  await expect(form.getByText("סומן מיקום", { exact: false })).toBeVisible()
  await expect(form.locator("[data-location-status]")).toContainText("המיקום נמצא")
})

test(
  "mobile artwork keeps its DOM nodes and header position through scrolling and all step transitions",
  { tag: ["@core-artwork", "@phone"] },
  async ({ page }) => {
    const form = await openForm(page)
    await page.emulateMedia({ reducedMotion: "no-preference" })
    // Exercise the real remounted dialog's entrance animation long enough that a visibility-only
    // baseline would sample its zoom. Keep motion enabled and the geometry assertions exact.
    await page.addStyleTag({ content: '[data-slot="dialog-content"][data-state="open"] { animation-duration: 800ms; }' })
    await form.getByRole("button", { name: "המיקום הנוכחי שלי", exact: true }).click()
    await page.evaluate(() => window.dispatchEvent(new Event("test:location")))
    await page.getByRole("button", { name: "זה המקום", exact: true }).click({ timeout: 15_000 })
    await expect(form.getByText("סומן מיקום", { exact: false })).toBeVisible()
    const header = form.locator("[data-add-art-header]")
    await expect(form).toHaveCSS("animation-duration", "0.8s")
    await expect.poll(() => form.evaluate((el) => el.getAnimations().every((animation) => animation.playState !== "running"))).toBe(true)
    const first = await header.boundingBox()
    expect(first!.height).toBe(await header.evaluate((el) => (el as HTMLElement).offsetHeight))
    await form
      .locator("img[src^='/art/']")
      .evaluateAll((imgs) => imgs.forEach((img, i) => img.setAttribute("data-test-original-node", String(i))))
    async function stable() {
      const box = await header.boundingBox()
      expect(Math.abs(box!.y - first!.y)).toBeLessThan(1)
      expect(box!.height).toBe(first!.height)
      await expect(form.locator("img[data-test-original-node]")).toHaveCount(3)
      await expect(header).toBeInViewport({ ratio: 1 })
    }
    await form.getByRole("button", { name: "המשך", exact: true }).click()
    await form.getByLabel("שם המקום", { exact: true }).fill("ספסל בדיקת איור")
    // Scroll the long details; the decoration belongs to a separate fixed region, so it must stay in place.
    await form.locator("fieldset:not([data-slot])").evaluate((el) => {
      let scroll: HTMLElement | null = el.parentElement
      while (scroll && getComputedStyle(scroll).overflowY !== "auto") scroll = scroll.parentElement
      if (scroll) scroll.scrollTop = scroll.scrollHeight
    })
    await stable()
    await form.getByRole("button", { name: "המשך", exact: true }).click()
    await expect(form.getByRole("heading", { name: "לפני שמוסיפים", exact: true })).toBeVisible()
    await stable()
    await form.getByRole("button", { name: "חזרה", exact: true }).click()
    await stable()
    await form.getByRole("button", { name: "חזרה", exact: true }).click()
    await stable()
    // The test intentionally keeps motion on. Visibility alone also matches a fading-in step, and axe would
    // measure its transient blended text colors. Audit the final state, without disabling the motion or contrast rule.
    await expect(form.getByRole("button", { name: "עריכת הפרטים", exact: true })).toHaveCount(0)
    await expect(form.getByLabel("שם המקום", { exact: true })).toHaveCount(0)
    const cascade = form.locator("fieldset .cascade")
    await expect(cascade).toHaveCount(1)
    await expect
      .poll(() =>
        cascade.evaluate((el) => {
          const nodes: Element[] = [el, ...el.children]
          for (let parent = el.parentElement; parent; parent = parent.parentElement) nodes.push(parent)
          return nodes.every((node) => Number(getComputedStyle(node).opacity) === 1)
        }),
      )
      .toBe(true)
    await audit(page)
  },
)
