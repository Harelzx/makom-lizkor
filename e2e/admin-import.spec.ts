import { readFile } from "node:fs/promises"
import { expect, test } from "./fixtures"
import fixture from "../fixtures/curated.json" with { type: "json" }

test("owner imports a curated packet through real moderation and retry leaves it unchanged", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const login = await request.post("/__dev/login", { data: { email: "dev@example.test" } })
  expect(login.ok()).toBe(true)
  const cookie = (login.headers()["set-cookie"] ?? "").split(";")[0].split("=").slice(1).join("=")
  await context.addCookies([{ name: "CF_Authorization", value: cookie, url: baseURL! }])
  const record = { ...fixture.places.find((p) => p.photos.length)!, id: "admin-import-ui-check", name_he: "בדיקת יבוא דרך המנהל" }
  const files = Object.fromEntries(
    await Promise.all(
      record.photos.map(async (p) => [
        p.file,
        {
          file: (await readFile(`fixtures/photos/${p.file}`)).toString("base64"),
          thumb: (await readFile(`fixtures/photos/thumb/${p.file}`)).toString("base64"),
        },
      ]),
    ),
  )
  await page.goto("/admin/")
  const publish = page.getByRole("button", { name: "פרסום המקומות שנבחרו", exact: true })
  await expect(page.getByText("יבוא מקומות האתר", { exact: true })).toBeVisible()
  await expect(publish).toHaveCount(0)
  await page.getByLabel("קובץ יבוא JSON", { exact: true }).setInputFiles({
    name: "approved-packet.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "makom-curated-v1", places: [record], files })),
  })
  await expect(page.getByText(`מוכנים לפרסום: 1 מקומות ו־${record.photos.length} תמונות.`, { exact: true })).toBeVisible()
  await publish.click()
  await expect(page.getByRole("status")).toHaveText("היבוא הושלם: 1 מקומות פורסמו, 0 מקומות קיימים נשארו ללא שינוי.", { timeout: 15_000 })
  const before = await page.request.get("/api/admin/places/admin-import-ui-check")
  expect(before.ok()).toBe(true)
  const original = await before.json()
  const version = await (await request.get("/api/v1/version")).json()
  const feedResponse = await request.get(`/api/v1/feed?v=${encodeURIComponent(version.v)}`)
  expect(feedResponse.ok()).toBe(true)
  const feed = await feedResponse.json()
  expect(JSON.stringify(feed)).toContain(record.name_he)
  expect(JSON.stringify(feed)).toContain("/media/public/")
  await publish.click()
  await expect(page.getByRole("status")).toHaveText("היבוא הושלם: 0 מקומות פורסמו, 1 מקומות קיימים נשארו ללא שינוי.")
  expect(await (await page.request.get("/api/admin/places/admin-import-ui-check")).json()).toEqual(original)
})

test("invalid import packet cannot publish any record", async ({ page, context, request, baseURL }) => {
  const login = await request.post("/__dev/login", { data: { email: "dev@example.test" } })
  expect(login.ok()).toBe(true)
  const value = (login.headers()["set-cookie"] ?? "").split(";")[0].split("=").slice(1).join("=")
  await context.addCookies([{ name: "CF_Authorization", value, url: baseURL! }])
  let writes = 0
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/admin/")) writes++
  })
  await page.goto("/admin/")
  await page.getByLabel("קובץ יבוא JSON", { exact: true }).setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"format":"makom-curated-v1","places":[],"files":{}}'),
  })
  await expect(page.getByRole("alert")).toContainText("קובץ היבוא אינו בפורמט הנדרש")
  await expect(page.getByRole("button", { name: "פרסום המקומות שנבחרו" })).toHaveCount(0)
  expect(writes).toBe(0)
})
