import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test"

// Skipping still plays the sunrise; the panel and its buttons arrive once the day begins.
const DAY = { timeout: 20_000 }
// On a desktop the search opens from the header's wide button («חיפוש מקום או קהילה ⌘K»).
const searchButton = (page: Page) => page.getByRole("button", { name: /^חיפוש מקום/ })

const skipIntro = async (b: Browser, opts: BrowserContextOptions = {}) => {
  const ctx = await b.newContext(opts)
  const page = await ctx.newPage()
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await expect(searchButton(page)).toBeVisible(DAY)
  return page
}

const search = async (page: Page, name: string) => {
  await searchButton(page).click()
  await page.getByRole("dialog").getByRole("combobox").fill(name)
  return page.getByRole("option", { name: new RegExp(name) })
}

test("a place submitted without email is moderated, published, and seen in another browser", async ({ browser }) => {
  // Four browsers and two sunrises.
  test.setTimeout(120_000)
  const name = `ספסל דמו ${Date.now()}`

  // A visitor submits, using the device's location, and gives no email at all.
  const visitor = await skipIntro(browser, { geolocation: { latitude: 31.42, longitude: 34.49 }, permissions: ["geolocation"] })
  await visitor.getByRole("button", { name: "הוספת מקום" }).first().click()
  const dialog = visitor.getByRole("dialog")
  await dialog.getByRole("button", { name: "המיקום הנוכחי שלי" }).click()
  await dialog.getByRole("button", { name: "המשך" }).click()
  await dialog.getByLabel("שם המקום").fill(name)
  await dialog.getByLabel("לזכר (לא חובה)").fill("נועה דמו")
  await dialog.getByRole("button", { name: "המשך" }).click()
  await dialog.getByText("הודעת הפרטיות", { exact: true }).click()
  await expect(dialog.getByText("התמונה נשארת במכשיר שלכם", { exact: false })).toBeVisible()
  for (const box of await dialog.getByRole("checkbox").all()) await box.check()
  const sent = visitor.waitForResponse((r) => r.url().endsWith("/api/v1/submissions") && r.status() === 201)
  await dialog.getByRole("button", { name: "שמירה והנחת כלנית" }).click()
  const { id } = (await (await sent).json()) as { id: string }
  const body = (await sent).request().postDataJSON() as Record<string, unknown>
  expect(Object.keys(body)).not.toContain("email")
  // The version recorded is the notice the form showed.
  expect(body.consent_version).toBe("notice.submission@2026-10-6")
  // The browser check ran, and its single-use token went with the place.
  expect((await sent).request().headers()["turnstile-token"]).toBeTruthy()
  // The submitter's own card says where the place went; it doesn't promise it stays only in this browser.
  await expect(visitor.getByText("נשלח לבדיקה", { exact: false }).first()).toBeVisible(DAY)
  await expect(visitor.getByText("נשמר רק בדפדפן הזה")).toHaveCount(0)

  // Someone else already has the map open before the place is approved, and doesn't see it yet.
  const other = await skipIntro(browser)
  await expect(await search(other, name)).toHaveCount(0)
  await other.keyboard.press("Escape")

  // A moderator approves it.
  const modCtx = await browser.newContext()
  await modCtx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const mod = await modCtx.newPage()
  await mod.goto("/admin/")
  const item = mod.getByRole("article", { name })
  await item.getByRole("button", { name: "אישור" }).click()
  await expect(item).toHaveCount(0)

  // The other browser's next check (it also runs whenever the tab comes back into view) brings the place in.
  await other.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await expect(await search(other, name)).toBeVisible()

  // The submitter sees one copy, not their local one beside the published one.
  const fed = visitor.waitForResponse((r) => r.url().includes("/api/v1/feed?") && r.status() === 200)
  await visitor.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await fed
  await expect(await search(visitor, name)).toHaveCount(1)

  // A shared link to the new place opens it, even though the place arrives only with the feed.
  const linked = await (await browser.newContext()).newPage()
  await linked.goto(`/#/place/${id}`)
  await expect(linked.getByRole("heading", { name })).toBeVisible(DAY)
  await expect(linked).toHaveURL(new RegExp(`#/place/${id}$`))
  // Published, the dedication is still there.
  await expect(linked.getByText("נועה דמו")).toBeVisible()
})

test("saving twice while the first send is slow sends the place once", async ({ browser }) => {
  const page = await skipIntro(browser, { geolocation: { latitude: 31.42, longitude: 34.49 }, permissions: ["geolocation"] })
  let posts = 0
  await page.route("**/api/v1/submissions", async (r) => {
    posts++
    await new Promise((done) => setTimeout(done, 1500))
    await r.continue()
  })
  await page.getByRole("button", { name: "הוספת מקום" }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "המיקום הנוכחי שלי" }).click()
  await dialog.getByRole("button", { name: "המשך" }).click()
  await dialog.getByLabel("שם המקום").fill(`ספסל דמו כפול ${Date.now()}`)
  await dialog.getByRole("button", { name: "המשך" }).click()
  for (const box of await dialog.getByRole("checkbox").all()) await box.check()
  const save = dialog.getByRole("button", { name: "שמירה והנחת כלנית" })
  await save.click()
  await save.click({ force: true }).catch(() => {})
  await page.keyboard.press("Enter")
  await expect(dialog).toBeHidden({ timeout: 10_000 })
  expect(posts).toBe(1)
})

test("a link to a contribution that isn't published falls back to the overview once the feed has come", async ({ page }) => {
  const fed = page.waitForResponse((r) => r.url().includes("/api/v1/feed?") && r.status() === 200)
  await page.goto("/#/place/p_01ZZZZZZZZZZZZZZZZZZZZZZZZ")
  await fed
  await expect(page).toHaveURL(/#\/$/)
})

test("About says that a place you add is sent for review", async ({ browser }) => {
  const page = await skipIntro(browser)
  await page.getByRole("button", { name: "פרטיות" }).click()
  await expect(page.getByText("נשלח אלינו לבדיקה", { exact: false }).first()).toBeVisible()
  await expect(page.getByText("לא נשלח אלינו", { exact: false })).toHaveCount(0)
})

test("the opening finishes and the site works while the API is down", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.route("**/api/**", (r) => r.abort())
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await expect(searchButton(page)).toBeVisible(DAY)
  await expect(page.getByRole("button", { name: "הוספת מקום" }).first()).toBeVisible()
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await page.waitForTimeout(500)
  expect(errors).toEqual([])
})
