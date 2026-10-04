import { expect, test, type Page } from "@playwright/test"

// The count told in headlines: only what had happened by the day of the visit, and smooth on a slow device.
// Both run the whole opening's first scenes, so they take their time.
test.use({ timezoneId: "Asia/Jerusalem" })

test("a headline from after the day of the visit stays out of the count", async ({ page }) => {
  test.slow()
  await page.clock.setFixedTime(new Date("2026-01-01T10:00:00+02:00"))
  await page.goto("/")
  await page.getByRole("button", { name: "בלי צליל" }).click()
  await page.keyboard.press("Enter")
  await expect(page.getByText("כל עשרים החטופים החיים בבית")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText("817 ימים")).toBeVisible({ timeout: 5_000 })
  // 26.01.2026 hadn't come yet
  await expect(page.getByText("רני גבילי", { exact: false })).toHaveCount(0)
})

/** Frame intervals for `ms`, measured in the page. */
const frames = (page: Page, ms: number) =>
  page.evaluate(
    (ms) =>
      new Promise<number[]>((done) => {
        const out: number[] = []
        let last = performance.now()
        const t0 = last
        const tick = (now: number) => {
          out.push(now - last)
          last = now
          if (now - t0 < ms) requestAnimationFrame(tick)
          else done(out)
        }
        requestAnimationFrame(tick)
      }),
    ms,
  )
const p95 = (f: number[]) => [...f].sort((a, b) => a - b)[Math.floor(f.length * 0.95)]
const longPerSecond = (f: number[]) => f.filter((x) => x > 50).length / (f.reduce((a, b) => a + b, 0) / 1000)

test("the pile of headlines keeps the frame rate of the quiet opening, on a CPU four times slower", async ({ page }) => {
  test.slow()
  await page.goto("/")
  await page.getByRole("button", { name: "בלי צליל" }).click()
  await page.waitForTimeout(2500)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
  // The same run measures both, so a busy machine slows them alike: what's compared is what the montage adds.
  const quiet = await frames(page, 3500)
  await page.keyboard.press("Enter")
  const montage = await frames(page, 10_500)
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })
  expect.soft(p95(montage), "95th percentile frame, montage against the quiet clock").toBeLessThanOrEqual(Math.max(20, p95(quiet) * 1.25))
  expect(longPerSecond(montage), "frames over 50 ms per second").toBeLessThanOrEqual(longPerSecond(quiet) + 0.4)
})
