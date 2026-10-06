import { expect, test, type Page } from "./fixtures"

// The film waits for one click: with sound or without. Sound files are fetched only for those who ask for sound.

/** The sound files the page asks for. */
const soundRequests = (page: Page) => {
  const files: string[] = []
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/sound/")) files.push(r.url())
  })
  return files
}

test("the clock waits at 06:28:57 until the visitor chooses how to watch", async ({ page }) => {
  await page.goto("/")
  await expect(page.locator("time")).toHaveText("06:28:57")
  await page.waitForTimeout(3000)
  await expect(page.locator("time")).toHaveText("06:28:57")
  // Enter keeps the choice in focus, with sound unless the visitor chose otherwise last time
  await expect(page.getByRole("button", { name: "עם צליל" })).toBeFocused()
  await page.getByRole("button", { name: "בלי צליל" }).click()
  await expect(page.locator("time")).toHaveText("06:29:00", { timeout: 10_000 })
})

test("without sound nothing is fetched; with sound the sounds load and the choice is remembered", async ({ page }) => {
  const files = soundRequests(page)
  await page.goto("/")
  await page.getByRole("button", { name: "בלי צליל" }).click()
  await expect(page.locator("time")).toHaveText("06:29:00", { timeout: 10_000 })
  expect(files).toEqual([])
  await expect(page.getByRole("button", { name: "צליל" })).toHaveAttribute("aria-pressed", "false")

  // changing one's mind during the film
  await page.getByRole("button", { name: "צליל" }).click()
  await expect(page.getByRole("button", { name: "צליל" })).toHaveAttribute("aria-pressed", "true")
  await expect.poll(() => files.length).toBeGreaterThan(0)

  // next time, the remembered choice is the one in focus
  await page.evaluate(() => localStorage.removeItem("makom-lizkor:v2-seen"))
  await page.getByRole("button", { name: "צליל" }).click()
  await page.reload()
  await expect(page.getByRole("button", { name: "בלי צליל" })).toBeFocused()
})
