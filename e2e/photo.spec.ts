import { expect, test } from "./fixtures"
import { openItem } from "./admin"
import { ownAddress } from "./publish"
import { fileURLToPath } from "node:url"

// The opening isn't what this file tests, and its sunrise took about 8 s on every page that went through it. A visitor
// who asked for less motion gets the day at once, with every flow the same; the opening keeps its own full-motion
// specs (three-years, sound, montage, panel).
test.use({ reducedMotion: "reduce" })

const DAY = { timeout: 20_000 }
const PICTURE = fileURLToPath(new URL("../public/art/dawn-field.webp", import.meta.url))

test(
  "a photo sent with a place reaches the moderator, and is published with it",
  { tag: ["@core-photo", "@phone"] },
  async ({ browser }) => {
    test.setTimeout(120_000)
    const name = `ספסל דמו עם תמונה ${Date.now()}`
    const page = await (
      await ownAddress(await browser.newContext({ geolocation: { latitude: 31.42, longitude: 34.49 }, permissions: ["geolocation"] }))
    ).newPage()
    // Every policy violation on the sender's page, as it happens: preparing and sending the photo must cause none, or an
    // enforced policy would block it (the production build carries the policy; the dev server's pages don't).
    await page.addInitScript(() => {
      const seen: string[] = []
      Object.assign(window, { __violations: seen })
      document.addEventListener("securitypolicyviolation", (e) => seen.push(`${e.effectiveDirective} ${e.blockedURI}`))
    })
    await page.goto("/")
    await page.getByRole("button", { name: "דילוג", exact: true }).click()
    await expect(page.getByRole("button", { name: /^(חיפוש|חיפוש מקום.*)$/ })).toBeVisible(DAY)
    await page.getByRole("button", { name: "הוספת מקום" }).first().click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("button", { name: "המיקום הנוכחי שלי" }).click()
    // The location arrives asynchronously and grows the form; pressing on before it would land where the button was.
    await page.getByRole("button", { name: "זה המקום", exact: true }).click({ timeout: 15_000 })
    await expect(dialog.getByText("סומן מיקום", { exact: false })).toBeVisible({ timeout: 15_000 })
    await dialog.getByRole("button", { name: "המשך" }).click()
    await dialog.getByLabel("שם המקום").fill(name)
    await dialog.getByLabel("תמונה של המקום (לא חובה)").setInputFiles(PICTURE)
    await dialog.getByLabel("מה רואים בתמונה?").fill("שדה כלניות בזריחה")
    await dialog.getByLabel("מי צילם?").fill("צלם דמו")
    await dialog.getByRole("checkbox", { name: /צילמתי את התמונה בעצמי/ }).check()
    await dialog.getByRole("button", { name: "המשך" }).click()
    // The last step's boxes, once the step with the photo's own box has gone.
    await expect(dialog.getByRole("heading", { name: "לפני שמוסיפים" })).toBeVisible()
    await expect(dialog.getByRole("checkbox", { name: /צילמתי את התמונה בעצמי/ })).toHaveCount(0)
    for (const box of await dialog.getByRole("checkbox").all()) await box.check()
    const uploaded = page.waitForResponse((r) => /\/api\/v1\/submissions\/p_[^/]+\/photo$/.test(r.url()) && r.status() === 200)
    await dialog.getByRole("button", { name: "שליחה לבדיקה" }).click()
    await uploaded
    expect(await page.evaluate(() => (window as unknown as { __violations: string[] }).__violations)).toEqual([])

    const modCtx = await browser.newContext()
    await modCtx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
    const mod = await modCtx.newPage()
    await mod.goto("/admin/")
    await mod.getByRole("button", { name: "מצב המערכת", exact: true }).click()
    await expect(mod.getByText(/ממתינות לבדיקה:/)).toBeVisible()
    const item = await openItem(mod, name)
    await expect(item.getByRole("img", { name: "שדה כלניות בזריחה" })).toBeVisible()
    await item.getByRole("button", { name: "אישור" }).click()
    await expect(item).toHaveCount(0)

    // Someone else opens the published place: the photo is there, with its description and its photographer.
    const other = await (await browser.newContext()).newPage()
    const fed = other.waitForResponse((r) => r.url().includes("/api/v1/feed?") && r.status() === 200)
    await other.goto("/")
    await other.getByRole("button", { name: "דילוג", exact: true }).click()
    await fed
    await other.getByRole("button", { name: /^(חיפוש|חיפוש מקום.*)$/ }).click()
    await other.getByRole("dialog").getByRole("combobox").fill(name)
    await other.getByRole("option", { name: new RegExp(name) }).click()
    const photo = other.getByRole("img", { name: "שדה כלניות בזריחה" })
    await expect(photo).toBeVisible(DAY)
    await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    expect(await photo.getAttribute("src")).toMatch(/^\/media\/public\//)
    await expect(other.getByText("צלם דמו")).toBeVisible()
  },
)
