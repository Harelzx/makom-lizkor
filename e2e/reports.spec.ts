import { expect, test, type APIRequestContext } from "@playwright/test"
import { published } from "./publish"

/** The place as the public feed has it now. */
async function inFeed(request: APIRequestContext, id: string) {
  const { v } = (await (await request.get("/api/v1/version")).json()) as { v: string }
  const { places } = (await (await request.get(`/api/v1/feed?v=${v}`)).json()) as { places: { id: string; name_he: string }[] }
  return places.find((p) => p.id === id)
}

test("a family's request hides the name as a precaution; a restoration is refused without the moderator's confirmation and accepted with it", async ({
  browser,
  request,
}) => {
  const name = "גן דמו לבקשת הסרה"
  const { id } = await published(browser, name)

  const res = await request.post("/api/v1/reports", {
    headers: { "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""), "Turnstile-Token": "XXXX.DUMMY.TOKEN.XXXX" },
    data: {
      placeId: id,
      elements: ["name_he"],
      requesterType: "family",
      relationship: "אחות",
      explanation: "שם המשפחה מופיע כאן בלי שביקשנו, אנא הסירו אותו בינתיים.",
      noticeVersion: "notice.report@2026-10-1",
    },
  })
  expect(res.status()).toBe(202)
  expect(((await res.json()) as { outcome: string }).outcome).toBe("hidden_for_review")
  await expect.poll(async () => (await inFeed(request, id))?.name_he).toBe("גן זיכרון")

  const ctx = await browser.newContext()
  await ctx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const mod = await ctx.newPage()
  await mod.goto("/admin/")
  const card = mod.getByRole("article", { name: `בקשה על ${name}` })
  await expect(card).toBeVisible()
  await expect(card.getByText("הוסתר באופן זהיר", { exact: false })).toBeVisible()

  await card.getByRole("button", { name: "החזרה עם בסיס מתועד" }).click()
  await card.getByLabel("הנימוק בכתב").fill("בדקנו מול אתר המועצה: השם פורסם שם ברשות המשפחה.")
  await card.getByLabel("הפנייה למשפחה או לגוף שהקים את האנדרטה").fill("שוחחנו עם האחות בטלפון, היא מסכימה")
  await card.getByLabel("תאריך הפנייה").fill("2026-10-06")
  // Only one of the two statements: refused, and nothing comes back.
  await card.getByLabel("יש בסיס חיובי ומתועד להחזרה").check()
  await card.getByRole("button", { name: /^החזרת השם/ }).click()
  await expect(mod.getByRole("alert")).toHaveText(/שתי ההצהרות/)
  expect((await inFeed(request, id))?.name_he).toBe("גן זיכרון")

  await card.getByLabel("הבסיס אינו היעדר תגובה, ואינו מחלוקת בין בני משפחה").check()
  await card.getByRole("button", { name: /^החזרת השם/ }).click()
  await expect(card.getByText("שום דבר לא מוסתר.")).toBeVisible()
  await expect.poll(async () => (await inFeed(request, id))?.name_he).toBe(name)
  await ctx.close()
})

test("the moderators' page reaches older requests a page at a time", async ({ browser }) => {
  const ctx = await browser.newContext()
  await ctx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const mod = await ctx.newPage()
  const request = (id: string, name: string, at: string) => ({
    id,
    place_id: `p_${id}`,
    origin: "contribution",
    elements: '["name_he"]',
    requester_type: "other",
    relationship: null,
    explanation: "דמו",
    has_contact: 0,
    outcome: "received",
    status: "open",
    received_at: at,
    handling_note: null,
    place_name: name,
  })
  // The list answered here, one request a page, so the test controls where the first page ends.
  await mod.route("**/api/admin/reports**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor")
    return route.fulfill({
      json: cursor
        ? { items: [request("r_old", "ספסל דמו ישן", "2029-01-01T00:00:00.000Z")], next: null }
        : { items: [request("r_new", "ספסל דמו חדש", "2029-01-02T00:00:00.000Z")], next: "2029-01-02T00:00:00.000Z|r_new" },
    })
  })
  await mod.goto("/admin/")
  await expect(mod.getByRole("article", { name: "בקשה על ספסל דמו חדש" })).toBeVisible()
  await expect(mod.getByRole("article", { name: "בקשה על ספסל דמו ישן" })).toHaveCount(0)
  await mod.getByRole("button", { name: "בקשות ישנות יותר" }).click()
  await expect(mod.getByRole("article", { name: "בקשה על ספסל דמו ישן" })).toBeVisible()
  await expect(mod.getByRole("button", { name: "בקשות ישנות יותר" })).toHaveCount(0)
  await ctx.close()
})
