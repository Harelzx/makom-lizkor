import { expect, test } from "./fixtures"
import { openItem } from "./admin"

/** One proposal as the admin queue lists it: a plain one, nothing to check. */
const proposal = (name: string) => ({
  id: "p_reject_demo",
  rev: 1,
  revisionId: "r_reject_demo",
  created_at: new Date().toISOString(),
  kind: "bench",
  name_he: name,
  lat: 31.42,
  lng: 34.49,
  location_precision: "exact",
  link_url: null,
  correction: 0,
  hidden: 0,
  photo_url: null,
  photo_alt: null,
  photo_credit: null,
  place_he: null,
  in_memory_of: null,
  story_he: "סיפור דמו.",
  on_private_property: 0,
  location_permission: 0,
  access_note_he: null,
})

test("a rejection is final, so it asks first, says what it does, and decides only on the second press", async ({ browser }) => {
  const ctx = await browser.newContext()
  await ctx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const mod = await ctx.newPage()
  const name = "ספסל דמו לדחייה"
  const decisions: { action: string }[] = []
  await mod.route("**/api/admin/queue", (route) => route.fulfill({ json: { items: decisions.length ? [] : [proposal(name)] } }))
  await mod.route("**/api/admin/places/*/transitions", (route) => {
    decisions.push(route.request().postDataJSON())
    return route.fulfill({ json: { ok: true } })
  })
  await mod.goto("/admin/")
  const item = await openItem(mod, name)

  await item.getByRole("button", { name: "דחיית ההצעה", exact: true }).click()
  const confirm = item.getByRole("alertdialog", { name: "דחיית ההצעה" })
  await expect(confirm).toContainText(`לדחות את «${name}»? ההצעה לא תתפרסם, ואם השולח השאיר מייל`)
  await expect(confirm).toContainText("אי אפשר לבטל")
  await confirm.getByRole("button", { name: "לא לדחות", exact: true }).click()
  await expect(confirm).toHaveCount(0)
  expect(decisions).toEqual([])

  // The key asks the same question; only the confirmation decides.
  await mod.keyboard.press("d")
  await expect(confirm).toBeVisible()
  expect(decisions).toEqual([])
  await confirm.getByRole("button", { name: "דחייה סופית", exact: true }).click()
  await expect(mod.getByText("ההצעה נדחתה")).toBeVisible()
  expect(decisions.map((d) => d.action)).toEqual(["reject"])
  await ctx.close()
})

test("every screen opens with what it is for, and an explanation folded away stays folded", async ({ browser }) => {
  const ctx = await browser.newContext()
  await ctx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const mod = await ctx.newPage()
  await mod.goto("/admin/")
  for (const [area, title] of [
    ["חיפוש מקום", "מתי משתמשים בחיפוש מקום"],
    ["יבוא מקומות", "מתי משתמשים ביבוא"],
    ["תקינות האתר", "מה רואים כאן"],
  ]) {
    await mod.getByRole("button", { name: area, exact: true }).click()
    await expect(mod.getByRole("button", { name: title, exact: true })).toHaveAttribute("aria-expanded", "true")
  }

  const toggle = mod.getByRole("button", { name: "מתי משתמשים ביבוא", exact: true })
  await mod.getByRole("button", { name: "יבוא מקומות", exact: true }).click()
  await expect(mod.getByText("רק למקומות שהאתר עצמו מוסיף", { exact: false })).toBeVisible()
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(mod.getByText("רק למקומות שהאתר עצמו מוסיף", { exact: false })).toHaveCount(0)

  await mod.reload()
  await mod.getByRole("button", { name: "יבוא מקומות", exact: true }).click()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  // Folding one screen's explanation leaves the others open.
  await mod.getByRole("button", { name: "תקינות האתר", exact: true }).click()
  await expect(mod.getByRole("button", { name: "מה רואים כאן", exact: true })).toHaveAttribute("aria-expanded", "true")
  await ctx.close()
})
