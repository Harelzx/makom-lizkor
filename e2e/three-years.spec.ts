import { expect, test, type Page } from "./fixtures"

// The time since that morning is computed from today's date in Israel, never written by hand.
// The browser runs on New York time on purpose: a visitor abroad must see the same count.
test.use({ timezoneId: "America/New_York" })

const panelLine = (years: string, days: string) => `${years} · ${days} ימים · לא נשכח`
/** A typed line: whole for screen readers and letter by letter on screen, so it is found by the paragraph that holds it. */
const typedLine = (page: Page, text: string) => page.locator("p", { hasText: text })

test("the opening stops at 06:29, counts the days to today, and says how long it has been", async ({ page }) => {
  // plays the whole opening and the sunrise
  test.slow()
  await page.clock.setFixedTime(new Date("2026-10-04T10:00:00+03:00"))
  await page.goto("/")
  await page.getByRole("button", { name: "בלי צליל" }).click()

  // the clock runs out its last seconds and stops, and the world stops with it
  // (by design that takes a few seconds after the page loads, more on a busy machine)
  await expect(page.locator("time")).toHaveText("06:29:00", { timeout: 10_000 })
  await expect(page.locator(".atmo-frozen")).toHaveCount(1)
  await expect(page.getByText("07.10.2023")).toBeVisible()
  await expect(page.getByText("בבוקר שמחת תורה נשבר השקט בדרום.")).toBeVisible()

  // The film plays on its own from here: a scene that moves on by itself just before an Enter lands would be skipped
  // whole (main's first CI run, 2026-10-07: on a slow runner the count was gone before it was looked for). Each scene
  // holds at least 1.4 s, long enough to be seen; the timeouts cover its arrival from the scene before.
  await expect(page.getByText("1,093 ימים")).toBeVisible({ timeout: 25_000 })

  await expect(typedLine(page, "מאז עברו שלוש שנים, והבוקר ההוא עדיין לא נגמר.")).toBeVisible({ timeout: 15_000 })
  // the words are typed, letter by letter: not there at once, and all there a few seconds later
  const untyped = page.locator(".type-letter:not(.type-on)")
  await expect(untyped.first()).toBeAttached()
  await expect(untyped).toHaveCount(0, { timeout: 8_000 })
  await expect(typedLine(page, "ולא נשכח, גם כשהזמן עובר.")).toBeVisible({ timeout: 15_000 })
  // time comes back once the words say we won't forget
  await expect(page.locator(".atmo-frozen")).toHaveCount(0, { timeout: 8_000 })
  await expect(page.getByText("שלוש שנים", { exact: true })).toBeVisible({ timeout: 15_000 })

  await page.getByRole("button", { name: "אל הבוקר" }).click()
  await expect(page.getByText("שלושה חורפים עברו מאז. ובכל אחד מהם, הכלניות חזרו לפרוח.")).toBeVisible()
  await expect(page.getByText(panelLine("שלוש שנים", "1,093"))).toBeVisible({ timeout: 15_000 })
})

test("the count follows the date in Israel, not the visitor's own", async ({ page }) => {
  // 22:30 on 6 October in New York is already 01:30 on 7 October in Israel
  await page.clock.setFixedTime(new Date("2026-10-06T22:30:00Z"))
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג" }).click()
  await expect(page.getByText(panelLine("שלוש שנים", "1,096"))).toBeVisible({ timeout: 15_000 })
})

for (const [date, years] of [
  ["2027-09-14T12:00:00+03:00", "שלוש שנים"],
  ["2027-09-15T12:00:00+03:00", "ארבע שנים"],
]) {
  test(`the years turn on 15 September, ahead of the memorial season (${date.slice(0, 10)})`, async ({ page }) => {
    await page.clock.setFixedTime(new Date(date))
    await page.goto("/")
    await page.getByRole("button", { name: "דילוג" }).click()
    await expect(page.getByText(new RegExp(`^${years} · [\\d,]+ ימים · לא נשכח$`))).toBeVisible({ timeout: 15_000 })
  })
}
