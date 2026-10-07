import { expect, test } from "./fixtures"

// The site's own places come with the feed (phase 7; adviser a50, review focus 1 and 2): the opening never waits for
// it, a first visit whose feed is slow still opens and fills in when it comes, and a link to a place keeps its place
// until the server's own feed has answered. Only a feed that answered can say a place isn't there: one that fails or
// hasn't come yet drops nothing.
test.use({ reducedMotion: "reduce" })

const DAY = { timeout: 20_000 }

test("a first visit whose feed comes late opens all the same, and fills in when it comes", async ({ page }) => {
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  await page.route("**/api/v1/feed?*", async (route) => {
    await held
    await route.continue()
  })
  await page.goto("/")
  // The name, with its line, before any place has come: no number in it yet.
  await expect(page.getByText(/^מפה של מקומות שהוקמו לזכרם/)).toBeVisible(DAY)
  release()
  // The feed's count, once it has come.
  await expect(page.getByText(/^מפה של \d+ מקומות שהוקמו לזכרם/)).toBeVisible(DAY)
})

test("a link to one of the site's own places waits for the feed, and opens the place when it comes", async ({ page }) => {
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  await page.route("**/api/v1/feed?*", async (route) => {
    await held
    await route.continue()
  })
  await page.goto("/#/place/car-wall-tkuma")
  await page.waitForTimeout(1500)
  // Not dropped while the feed is still on its way.
  await expect(page).toHaveURL(/#\/place\/car-wall-tkuma$/)
  release()
  await expect(page.getByRole("heading", { name: "קיר המכוניות ליד תקומה" })).toBeVisible(DAY)
  await expect(page).toHaveURL(/#\/place\/car-wall-tkuma$/)
})

test("a feed that fails drops no link; one that answers drops a place it doesn't have", async ({ page }) => {
  await page.route("**/api/v1/feed?*", (route) => route.fulfill({ status: 503, body: "" }))
  await page.goto("/#/place/no-such-place")
  await page.waitForTimeout(3000)
  // The server couldn't answer: the link stands.
  await expect(page).toHaveURL(/#\/place\/no-such-place$/)
  // Now the feed answers, without that place: the overview.
  await page.unroute("**/api/v1/feed?*")
  await page.evaluate(() => window.dispatchEvent(new Event("online")))
  await expect(page).toHaveURL(/#\/$/, DAY)
})
