import { expect, test, type Browser, type BrowserContextOptions, type Page } from "./fixtures"
import { openItem } from "./admin"
import { ownAddress } from "./publish"

// The opening isn't what this file tests, and its sunrise took about 8 s on every page that went through it. A visitor
// who asked for less motion gets the day at once, with every flow the same; the opening keeps its own full-motion
// specs (three-years, sound, montage, panel).
test.use({ reducedMotion: "reduce" })

// Skipping still plays the sunrise; the panel and its buttons arrive once the day begins.
const DAY = { timeout: 20_000 }
// On a desktop the search opens from the header's wide button («חיפוש מקום או קהילה ⌘K»).
const searchButton = (page: Page) => page.getByRole("button", { name: /^חיפוש מקום/ })

const skipIntro = async (b: Browser, opts: BrowserContextOptions = {}) => {
  const ctx = await ownAddress(await b.newContext(opts))
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

test(
  "a place submitted without email is moderated, published, and seen in another browser",
  { tag: "@core-submission" },
  async ({ browser }) => {
    // Four browsers and two sunrises.
    test.setTimeout(120_000)
    const name = `ספסל דמו ${Date.now()}`

    // A visitor submits, using the device's location, and gives no email at all.
    const visitor = await skipIntro(browser, { geolocation: { latitude: 31.42, longitude: 34.49 }, permissions: ["geolocation"] })
    await visitor.getByRole("button", { name: "הוספת מקום" }).first().click()
    const dialog = visitor.getByRole("dialog")
    await dialog.getByRole("button", { name: "המיקום הנוכחי שלי" }).click()
    // The location arrives asynchronously and grows the form; pressing on before it would land where the button was.
    await visitor.getByRole("button", { name: "זה המקום", exact: true }).click({ timeout: 15_000 })
    await expect(dialog.getByText("סומן מיקום", { exact: false })).toBeVisible({ timeout: 15_000 })
    await dialog.getByRole("button", { name: "המשך" }).click()
    await dialog.getByLabel("שם המקום").fill(name)
    await dialog.getByLabel("לזכר (לא חובה)").fill("נועה דמו")
    await dialog.getByRole("button", { name: "המשך" }).click()
    // The last step has two boxes (family, consent); wait for the step before it to finish leaving, or a box of
    // the leaving step is collected and never comes back (and its photo note would read as the notice's).
    await expect(dialog.getByRole("checkbox")).toHaveCount(2)
    await dialog.getByText("הודעת הפרטיות", { exact: true }).click()
    // The notice's own photo paragraph: the photo field's description above it says the same, in its own words.
    const notice = dialog.getByText("תמונה: אם צירפתם תמונה", { exact: false })
    await expect(notice).toBeVisible()
    await expect(notice).toContainText("מתפרסמת רק אם המקום אושר")
    for (const box of await dialog.getByRole("checkbox").all()) await box.check()
    const sent = visitor.waitForResponse((r) => r.url().endsWith("/api/v1/submissions") && r.status() === 201)
    await dialog.getByRole("button", { name: "שליחה לבדיקה" }).click()
    const { id } = (await (await sent).json()) as { id: string }
    const body = (await sent).request().postDataJSON() as Record<string, unknown>
    expect(Object.keys(body)).not.toContain("email")
    // The version recorded is the notice the form showed.
    expect(body.consent_version).toBe("notice.submission@2026-10-15")
    // The browser check ran, and its single-use token went with the place.
    expect((await sent).request().headers()["turnstile-token"]).toBeTruthy()
    await visitor.getByRole("button", { name: "לצפייה בהצעה", exact: true }).click({ timeout: 15_000 })
    // The submitter's own card says where the place went; it doesn't promise it stays only in this browser.
    await expect(visitor.getByText("נשלח לבדיקה", { exact: false }).first()).toBeVisible(DAY)
    await expect(visitor.getByText("נשמר רק בדפדפן הזה")).toHaveCount(0)

    // Someone else already has the map open before the place is approved, and doesn't see it yet.
    const other = await skipIntro(browser)
    await expect(await search(other, name)).toHaveCount(0)
    await other.keyboard.press("Escape")

    // The submitter's page brings the approved place in with whichever check comes first after the approval (its own
    // timer, or the tab coming back): waited for from before the approval, so a check that came early isn't missed.
    const fed = visitor.waitForResponse(
      async (r) => r.url().includes("/api/v1/feed?") && r.status() === 200 && (await r.text()).includes(id),
    )

    // A moderator approves it.
    const modCtx = await browser.newContext()
    await modCtx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
    const mod = await modCtx.newPage()
    await mod.goto("/admin/")
    const item = await openItem(mod, name)
    await item.getByRole("button", { name: "אישור" }).click()
    await expect(item).toHaveCount(0)

    // The other browser's next check (it also runs whenever the tab comes back into view) brings the place in.
    await other.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
    await expect(await search(other, name)).toBeVisible()

    // The submitter sees one copy, not their local one beside the published one.
    await visitor.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
    await fed
    // The keyed exit briefly retains the old device card beside the new approved card. Require one settled card.
    await expect(visitor.getByRole("heading", { name, exact: true })).toHaveCount(1)
    await expect(visitor.getByRole("heading", { name, exact: true })).toBeVisible(DAY)
    await expect(visitor).toHaveURL(new RegExp(`#/place/${id}$`))
    await expect(await search(visitor, name)).toHaveCount(1)
    await visitor.keyboard.press("Escape")
    await expect(visitor.getByRole("button", { name: "מעקב אחרי ההצעה", exact: true })).toBeVisible()
    await expect(visitor.getByRole("button", { name: "שיתוף", exact: true })).toBeVisible()
    await expect(visitor.getByRole("button", { name: "העתקת קישור מקומי", exact: true })).toHaveCount(0)

    // A shared link to the new place opens it, even though the place arrives only with the feed.
    const linked = await (await browser.newContext()).newPage()
    await linked.goto(`/#/place/${id}`)
    await expect(linked.getByRole("heading", { name })).toBeVisible(DAY)
    await expect(linked).toHaveURL(new RegExp(`#/place/${id}$`))
    // Published, the dedication is still there.
    await expect(linked.getByText("נועה דמו")).toBeVisible()
    await expect(linked.getByRole("button", { name: "מעקב אחרי ההצעה", exact: true })).toHaveCount(0)

    // Removing the owner's separate device receipt removes its capability, not the approved public card.
    await visitor.getByRole("button", { name: "מחיקת העותק מהמכשיר", exact: true }).click()
    await visitor.getByRole("alertdialog").getByRole("button", { name: "מחיקת העותק", exact: true }).click()
    await expect(visitor.getByRole("heading", { name, exact: true })).toBeVisible()
    await expect(visitor.getByRole("button", { name: "מעקב אחרי ההצעה", exact: true })).toHaveCount(0)
    await visitor.reload()
    await expect(visitor.getByRole("heading", { name, exact: true })).toBeVisible(DAY)
    await expect(visitor.getByRole("button", { name: "מעקב אחרי ההצעה", exact: true })).toHaveCount(0)
  },
)

test("approval while the receipt is open resolves its device id to the public card and keeps owner tracking", async ({ page, browser }) => {
  const name = `בדיקת קבלה לפני סגירה ${Date.now()}`
  await page.goto("/#/place/car-wall-tkuma")
  await expect(page.getByRole("heading", { name: "קיר המכוניות ליד תקומה", exact: true })).toBeVisible(DAY)
  await page.getByRole("button", { name: "הוספת מקום", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByText("הזנת נקודה במקלדת", { exact: true }).press("Enter")
  await dialog.getByRole("textbox", { name: "קו רוחב", exact: true }).fill("31.42")
  await dialog.getByRole("textbox", { name: "קו אורך", exact: true }).fill("34.49")
  await dialog.getByRole("textbox", { name: "קו אורך", exact: true }).press("Enter")
  await dialog.getByRole("button", { name: "המשך", exact: true }).click()
  await dialog.getByLabel("שם המקום").fill(name)
  await dialog.getByRole("button", { name: "המשך", exact: true }).click()
  await expect(dialog.getByRole("checkbox")).toHaveCount(2)
  for (const box of await dialog.getByRole("checkbox").all()) await box.check()
  const sent = page.waitForResponse((r) => r.url().endsWith("/api/v1/submissions") && r.status() === 201)
  await dialog.getByRole("button", { name: "שליחה לבדיקה", exact: true }).click()
  const { id } = (await (await sent).json()) as { id: string }
  await expect(page.getByRole("button", { name: "לצפייה בהצעה", exact: true })).toBeVisible(DAY)
  const fed = page.waitForResponse(async (r) => r.url().includes("/api/v1/feed?") && r.status() === 200 && (await r.text()).includes(id))
  const moderator = await browser.newContext()
  await moderator.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const mod = await moderator.newPage()
  await mod.goto("/admin/")
  const item = await openItem(mod, name)
  await item.getByRole("button", { name: "אישור ופרסום", exact: true }).click()
  await expect(item).toHaveCount(0)
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await fed
  await page.getByRole("button", { name: "לצפייה בהצעה", exact: true }).click()
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible(DAY)
  await expect(page).toHaveURL(new RegExp(`#/place/${id}$`))
  await expect(page.getByRole("button", { name: "מעקב אחרי ההצעה", exact: true })).toBeVisible()
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
  // The location arrives asynchronously and grows the form; pressing on before it would land where the button was.
  await page.getByRole("button", { name: "זה המקום", exact: true }).click({ timeout: 15_000 })
  await expect(dialog.getByText("סומן מיקום", { exact: false })).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole("button", { name: "המשך" }).click()
  await dialog.getByLabel("שם המקום").fill(`ספסל דמו כפול ${Date.now()}`)
  await dialog.getByRole("button", { name: "המשך" }).click()
  // The last step has two boxes (family, consent); wait for the step before it to finish leaving, or a box of
  // the leaving step is collected and never comes back.
  await expect(dialog.getByRole("checkbox")).toHaveCount(2)
  for (const box of await dialog.getByRole("checkbox").all()) await box.check()
  const save = dialog.locator("button[aria-busy]")
  await save.click()
  await expect(save).toBeDisabled()
  await save.dispatchEvent("click")
  await dialog.locator("input").first().dispatchEvent("keydown", { key: "Enter" })
  await page.getByRole("button", { name: "לצפייה בהצעה", exact: true }).click({ timeout: 15_000 })
  await expect(dialog).toBeHidden()
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

test("the opening finishes and the site works while the API is down", { tag: "@core-api-down" }, async ({ page }) => {
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
