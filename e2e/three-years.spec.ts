import { expect, test, type Page } from "./fixtures"

// The time since that morning is computed from today's date in Israel, never written by hand.
// The browser runs on New York time on purpose: a visitor abroad must see the same count.
test.use({ timezoneId: "America/New_York" })

const panelLine = (years: string, days: string) => `${years} · ${days} ימים · לא נשכח`
// The day (and the panel with it) comes once both steps of the sunrise have painted, and each waits for the map's style
// to load (intro.tsx, shiftLight); skipping the film takes the same path, after the map's own chunk. On GitHub's runner
// the page was still in the sunrise 15 s after its line, and 15 s after a skip (three-years:47 on 1e650ef's CI).
const DAY_COMES = { timeout: 30_000 }
/** A typed line: whole for screen readers and letter by letter on screen, so it is found by the paragraph that holds it. */
const typedLine = (page: Page, text: string) => page.locator("p", { hasText: text })

/** The opening's clock as a screen reader reads it: its one readable time, not the rolling digits beside it. */
const CLOCK = "time > :not([aria-hidden='true'])"
/** The opening's first scene: the clock stopped at 06:29, the world stopped with it, the date and what happened under it. */
const FIRST_SCENE = { clock: "06:29:00", frozen: 1, date: true, line: true }
/** What the page saw of the first scene: the first sample equal to it in time, or else the last one, when, and if in time. */
type Seen = { seen: Record<string, unknown>; at: number; inTime: boolean }

/**
 * Watches the opening's first scene from inside the page, from the click that starts the film until `within` ms after it.
 * Every 100 ms it reads in one go, so every value is from the same moment, the clock's readable time, how many frozen
 * atmospheres there are, and whether the date and the line are visible, and it stops at the first sample equal to `want`
 * or at the first one taken after the deadline. The date and the line are found as getByText finds them (the smallest
 * elements whose text, whitespace collapsed, contains it, ignoring case; more than one is a strict-mode error) and judged
 * as toBeVisible judges (Playwright 1.63, read from playwright-core: display: contents by its children; checkVisibility();
 * visibility: visible; a non-empty box). Opacity is not looked at, so this checks that they are there together, not that
 * their fades have finished.
 *
 * Time is the page's own, from the click as the page received it (the film's timeline starts there): performance.now
 * runs in real time under page.clock.setFixedTime, which fixes only the date. So neither the click's return to the test
 * nor a sample's way back counts against the deadline: on a loaded runner a sample that matched in time reached the test
 * 0.9 s later, after its deadline, and a page evaluation took up to 3.9 s there and back (CI 37694842681).
 */
const watchFirstScene = (page: Page, want: Record<string, unknown>, within: number) =>
  page.evaluate(
    ([want, within, clock, dateText, lineText]) => {
      const norm = (s: string) => s.replace(/\s+/g, " ").trim()
      const textOf = (e: Element) => norm(e.textContent ?? "").toLowerCase()
      const visible = (e: Element): boolean => {
        const style = getComputedStyle(e)
        if (style.display === "contents")
          return [...e.childNodes].some((c) => {
            if (c instanceof Element) return visible(c)
            if (c.nodeType !== Node.TEXT_NODE) return false
            const range = document.createRange()
            range.selectNode(c)
            const r = range.getBoundingClientRect()
            return r.width > 0 && r.height > 0
          })
        if (!e.checkVisibility() || style.visibility !== "visible") return false
        const r = e.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      }
      const shown = (text: string) => {
        const t = norm(text).toLowerCase()
        const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"])
        const all = [...document.body.querySelectorAll("*")].filter((e) => !skip.has(e.tagName) && textOf(e).includes(t))
        const own = all.filter((e) => ![...e.children].some((c) => textOf(c).includes(t)))
        return own.length > 1 ? `${own.length} elements` : own.length === 1 && visible(own[0])
      }
      const sample = (): Record<string, unknown> => {
        const clocks = document.querySelectorAll(clock)
        return {
          clock: clocks.length === 1 ? norm(clocks[0].textContent ?? "") : `${clocks.length} readable clocks`,
          frozen: document.querySelectorAll(".atmo-frozen").length,
          date: shown(dateText),
          line: shown(lineText),
        }
      }
      const same = (a: Record<string, unknown>) =>
        Object.keys(a).length === Object.keys(want).length && Object.keys(want).every((k) => a[k] === want[k])
      const out = window as unknown as { firstScene?: Seen; clickAt?: number }
      addEventListener(
        "click",
        () => {
          if (out.clickAt !== undefined) return
          const clickAt = (out.clickAt = performance.now())
          const look = () => {
            const seen = sample()
            const at = performance.now() - clickAt
            const inTime = at <= within
            if (!inTime || same(seen)) out.firstScene = { seen, at, inTime }
            else setTimeout(look, 100)
          }
          look()
        },
        { capture: true },
      )
    },
    [want, within, CLOCK, "07.10.2023", "בבוקר שמחת תורה נשבר השקט בדרום."] as const,
  )

/** What the watcher saw, once it has seen it; the way back is bounded, the deadline itself is the page's. */
const firstSceneSeen = async (page: Page) => {
  const seen = await page.waitForFunction(() => (window as unknown as { firstScene?: Seen }).firstScene, undefined, {
    polling: 100,
    timeout: 30_000,
  })
  return (await seen.jsonValue()) as Seen
}

test("the opening stops at 06:29, counts the days to today, and says how long it has been", async ({ page }) => {
  // plays the whole opening and the sunrise
  test.slow()
  await page.clock.setFixedTime(new Date("2026-10-04T10:00:00+03:00"))
  await page.goto("/")
  await watchFirstScene(page, FIRST_SCENE, 10_000)
  await page.getByRole("button", { name: "בלי צליל" }).click()

  // the clock runs out its last seconds and stops, and the world stops with it, with the date and what happened under it
  // (by design that takes a few seconds after the click, more on a busy machine). All four in every sample, read in one
  // go: the clock's last tick and the date's scene run on timers of their own, and on a loaded runner the clock stopped
  // late while the scene's timer was already moving on; four waits one after another reached the date after it had left
  // (CI 37646691672). Within 10 s of the click, as the page received it.
  expect(await firstSceneSeen(page)).toMatchObject({ seen: FIRST_SCENE, inTime: true })

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
  await expect(page.getByText(panelLine("שלוש שנים", "1,093"))).toBeVisible(DAY_COMES)
})

test("the count follows the date in Israel, not the visitor's own", async ({ page }) => {
  // 22:30 on 6 October in New York is already 01:30 on 7 October in Israel
  await page.clock.setFixedTime(new Date("2026-10-06T22:30:00Z"))
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג" }).click()
  await expect(page.getByText(panelLine("שלוש שנים", "1,096"))).toBeVisible(DAY_COMES)
})

for (const [date, years] of [
  ["2027-09-14T12:00:00+03:00", "שלוש שנים"],
  ["2027-09-15T12:00:00+03:00", "ארבע שנים"],
]) {
  test(`the years turn on 15 September, ahead of the memorial season (${date.slice(0, 10)})`, async ({ page }) => {
    await page.clock.setFixedTime(new Date(date))
    await page.goto("/")
    await page.getByRole("button", { name: "דילוג" }).click()
    await expect(page.getByText(new RegExp(`^${years} · [\\d,]+ ימים · לא נשכח$`))).toBeVisible(DAY_COMES)
  })
}

test("a returning visitor comes straight back to the day", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("makom-lizkor:v2-seen", "1"))
  // Watched from the page's first script: neither the name's gate nor the film's line ever shows, not even for a frame.
  await page.addInitScript(() => {
    const w = window as unknown as { __opening: boolean }
    w.__opening = false
    const look = () => {
      const text = document.body?.innerText.replace(/\s+/g, " ") ?? ""
      if (text.includes("אל הבוקר") || /עברו מאז\. ?ובכל אחד מהם/.test(text)) w.__opening = true
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
  await page.goto("/")
  await expect(page.locator("#places")).toBeVisible({ timeout: 10000 })
  await expect(page.locator('[aria-labelledby="intro-title"]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __opening: boolean }).__opening)).toBe(false)
})
