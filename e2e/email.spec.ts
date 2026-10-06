import { expect, test } from "@playwright/test"
import { ownAddress } from "./publish"

// The opening isn't what this file tests, and its sunrise took about 8 s on every page that went through it. A visitor
// who asked for less motion gets the day at once, with every flow the same; the opening keeps its own full-motion
// specs (three-years, sound, montage, panel).
test.use({ reducedMotion: "reduce" })

const DAY = { timeout: 20_000 }

test("an optional email is verified from the site, then receives a tracking link that opens the status", async ({ browser }) => {
  test.setTimeout(120_000)
  const name = `ספסל דמו עם מייל ${Date.now()}`
  const to = `visitor${Date.now()}@example.test`
  const page = await (
    await ownAddress(await browser.newContext({ geolocation: { latitude: 31.42, longitude: 34.49 }, permissions: ["geolocation"] }))
  ).newPage()
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await expect(page.getByRole("button", { name: /^חיפוש מקום/ })).toBeVisible(DAY)
  await page.getByRole("button", { name: "הוספת מקום" }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "המיקום הנוכחי שלי" }).click()
  // The location arrives asynchronously and grows the form; pressing on before it would land where the button was.
  await expect(dialog.getByText("סומן מיקום", { exact: false })).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole("button", { name: "המשך" }).click()
  await dialog.getByLabel("שם המקום").fill(name)
  await dialog.getByRole("button", { name: "המשך" }).click()
  await dialog.getByLabel("מייל (לא חובה)").fill(to)
  // The last step has two boxes (family, consent); wait for the step before it to finish leaving, or a box of
  // the leaving step is collected and never comes back.
  await expect(dialog.getByRole("checkbox")).toHaveCount(2)
  for (const box of await dialog.getByRole("checkbox").all()) await box.check()
  await dialog.getByRole("button", { name: "שמירה והנחת כלנית" }).click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })

  // What the development mail adapter would have sent: a verification link, nothing about the place.
  const mailbox = async () => (await (await page.request.get(`/__dev/mail?to=${encodeURIComponent(to)}`)).json()) as { text: string }[]
  const [verification] = await mailbox()
  expect(verification.text).not.toContain(name)
  const verifyLink = /https?:\/\/\S+#\/verify\/\S+/.exec(verification.text)![0]

  // Opening the link asks for a click; a mail scanner following the link confirms nothing.
  const other = await (await browser.newContext()).newPage()
  await other.goto(verifyLink.replace(/^https?:\/\/[^/]+/, ""))
  const confirm = other.getByRole("dialog", { name: "אימות כתובת המייל" })
  await expect(confirm).toBeVisible(DAY)
  await expect(other).toHaveURL(/#\/$/)
  expect(await mailbox()).toHaveLength(1)
  await confirm.getByRole("button", { name: "אישור הכתובת" }).click()
  await expect(confirm.getByText("הכתובת אומתה", { exact: false })).toBeVisible()

  const mails = await mailbox()
  expect(mails).toHaveLength(2)
  const trackLink = /https?:\/\/\S+#\/track\/\S+/.exec(mails[1].text)![0]
  await other.goto(trackLink.replace(/^https?:\/\/[^/]+/, ""))
  const view = other.getByRole("dialog", { name: "מצב ההצעה" })
  await expect(view.getByText("ממתינה לבדיקה")).toBeVisible(DAY)
  await expect(view.getByText(name)).toBeVisible()
})
