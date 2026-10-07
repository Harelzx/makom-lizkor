import { expect, test, type Page } from "./fixtures"
import { published } from "./publish"

// The opening isn't what this file tests, and its sunrise took about 8 s on every page that went through it. A visitor
// who asked for less motion gets the day at once, with every flow the same; the opening keeps its own full-motion
// specs (three-years, sound, montage, panel).
test.use({ reducedMotion: "reduce" })

const DAY = { timeout: 20_000 }
/** A moderator's change comes from the admin page itself (the Worker refuses one from elsewhere). */
const SAME_SITE = { "Sec-Fetch-Site": "same-origin" }

test("a share page opens the site at its place, skipping the opening, under the usual address", async ({ page }) => {
  await page.goto("/place/car-wall-tkuma")
  await expect(page.getByRole("heading", { name: "קיר המכוניות ליד תקומה" })).toBeVisible(DAY)
  await expect(page.getByRole("button", { name: "עם צליל" })).toHaveCount(0)
  // The address becomes the hash route the rest of the site reads, so reload and Back work as for any card.
  await expect(page).toHaveURL(/\/#\/place\/car-wall-tkuma$/)
  await page.reload()
  await expect(page.getByRole("heading", { name: "קיר המכוניות ליד תקומה" })).toBeVisible(DAY)
  await page.getByRole("button", { name: "כל המקומות" }).click()
  await expect(page).toHaveURL(/\/#\/$/)
})

test("an approved contribution's share page opens its card before the feed answers", async ({ browser }) => {
  const name = `גינת דמו שיתוף ${Date.now()}`
  const { id } = await published(browser, name)
  const page = await (await browser.newContext()).newPage()
  // No feed at all: the card can only come from the fields the page carries.
  await page.route("**/api/v1/{version,feed}*", (route) => route.abort())
  await page.goto(`/place/${id}`)
  await expect(page.getByRole("heading", { name })).toBeVisible(DAY)
  await expect(page).toHaveURL(new RegExp(`/#/place/${id}$`))
})

test("the share button gives the share page's address, which link previews can read", async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] })
  const page = await ctx.newPage()
  await page.goto("/#/place/car-wall-tkuma")
  await page.getByRole("button", { name: "שיתוף" }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^http:\/\/[^/]+\/place\/car-wall-tkuma$/)
})

test("a place taken back opens the overview, and stays off this browser's offline copy after a reload", async ({ browser }) => {
  test.setTimeout(90_000)
  const name = `גינת דמו שנמשכה ${Date.now()}`
  const { id, trackingToken } = await published(browser, name)
  const page = await (await browser.newContext()).newPage()
  // Seen once: the browser's offline copy of the feed holds it (read from storage, not assumed after a wait).
  await page.goto(`/#/place/${id}`)
  await expect(page.getByRole("heading", { name })).toBeVisible(DAY)
  await expect.poll(() => snapshotIds(page), { timeout: 20_000 }).toContain(id)
  await page.request.post(`/api/v1/submissions/${id}/withdraw`, { headers: { Authorization: `Bearer ${trackingToken}` } })

  await page.route("**/api/v1/{version,feed}*", (route) => route.abort())
  const res = await page.goto(`/place/${id}`)
  expect(res!.status()).toBe(410)
  await expect(page).toHaveURL(/\/#\/$/)
  await expect(page.getByRole("heading", { name })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "עם צליל" })).toHaveCount(0)
  await expectUnlisted(page, name)
  // A reload of the overview, still with no server: the address no longer says anything about the place, and the old
  // offline copy still holds it, yet it stays off.
  await page.reload()
  // A plain visit now, so the opening plays; skip it as a visitor would.
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await expectUnlisted(page, name)
})

test("one of the site's own places hidden whole stays off an offline reload, and comes back with the server's feed once restored (P7-OFFLINE-1)", async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const id = "shelter-mefalsim-entrance"
  const name = "מיגונית בכניסה למפלסים"
  const mod = await browser.newContext()
  await mod.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const rev = async () => ((await (await mod.request.get(`/api/admin/places/${id}`)).json()) as { rev: number }).rev
  const page = await (await browser.newContext()).newPage()
  await page.goto(`/#/place/${id}`)
  await expect(page.getByRole("heading", { name })).toBeVisible(DAY)
  await expect.poll(() => snapshotIds(page), { timeout: 20_000 }).toContain(id)
  const hidden = await mod.request.post("/api/admin/suppressions", {
    headers: SAME_SITE,
    data: { placeId: id, fields: ["whole"], expectedRev: await rev(), reason: "בדיקת הסתרה בדמו" },
  })
  expect(hidden.status()).toBe(200)
  try {
    await page.route("**/api/v1/{version,feed}*", (route) => route.abort())
    const res = await page.goto(`/place/${id}`)
    expect(res!.status()).toBe(410)
    await expect(page).toHaveURL(/\/#\/$/)
    await expectUnlisted(page, name)
    // Reloaded with no server: the offline copy still holds it, the address says nothing of it, yet it stays off.
    expect(await snapshotIds(page)).toContain(id)
    await page.reload()
    await page.getByRole("button", { name: "דילוג", exact: true }).click()
    await expectUnlisted(page, name)
  } finally {
    // Restored, so the specs after this one find the place as the seed left it.
    const { suppressions } = (await (await mod.request.get(`/api/admin/places/${id}`)).json()) as { suppressions: { id: string }[] }
    const lifted = await mod.request.post(`/api/admin/suppressions/${suppressions[0].id}/lift`, {
      headers: SAME_SITE,
      data: {
        expectedRev: await rev(),
        basisCode: "hidden_in_error",
        basisNote: "ההסתרה נעשתה בבדיקה בלבד, ואין סיבה להשאיר אותה.",
        confirm: { affirmativeBasis: true, notNonresponseOrDispute: true },
      },
    })
    expect(lifted.status()).toBe(200)
  }
  // The server's own feed lists it again: the note gives way, and the place is found.
  await page.unroute("**/api/v1/{version,feed}*")
  await page.reload()
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await page.getByRole("button", { name: /^חיפוש מקום/ }).click({ timeout: 20_000 })
  await page.getByRole("dialog").getByRole("combobox").fill(name)
  await expect(page.getByRole("option", { name: new RegExp(name) }).first()).toBeVisible(DAY)
})

/** The ids in this browser's offline copy of the feed, read from its storage. */
const snapshotIds = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const req = indexedDB.open("makom-lizkor-v2")
        req.onsuccess = () => {
          const get = req.result.transaction("v1").objectStore("v1").get("feed")
          get.onsuccess = () => resolve(((get.result as { places?: { id: string }[] } | undefined)?.places ?? []).map((p) => p.id))
        }
      }),
  )

/** Off the map and the list: a search finds the site's own place (the search works) but not this one. */
async function expectUnlisted(page: Page, name: string) {
  await page.getByRole("button", { name: /^חיפוש מקום/ }).click({ timeout: 20_000 })
  const box = page.getByRole("dialog").getByRole("combobox")
  await box.fill("קיר המכוניות")
  await expect(page.getByRole("option", { name: /קיר המכוניות/ }).first()).toBeVisible(DAY)
  await box.fill(name)
  await page.waitForTimeout(500)
  await expect(page.getByRole("option", { name: new RegExp(name) })).toHaveCount(0)
  await page.keyboard.press("Escape")
}
