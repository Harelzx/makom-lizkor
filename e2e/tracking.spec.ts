import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test"

const DAY = { timeout: 20_000 }
const GEO: BrowserContextOptions = { geolocation: { latitude: 31.42, longitude: 34.49 }, permissions: ["geolocation"] }

async function submit(b: Browser, name: string): Promise<Page> {
  const page = await (await b.newContext(GEO)).newPage()
  await page.goto("/")
  await page.getByRole("button", { name: "דילוג", exact: true }).click()
  await expect(page.getByRole("button", { name: /^חיפוש מקום/ })).toBeVisible(DAY)
  await page.getByRole("button", { name: "הוספת מקום" }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "המיקום הנוכחי שלי" }).click()
  await dialog.getByRole("button", { name: "המשך" }).click()
  await dialog.getByLabel("שם המקום").fill(name)
  await dialog.getByRole("button", { name: "המשך" }).click()
  // The last step has two boxes (family, consent); wait for the step before it to finish leaving, or a box of
  // the leaving step is collected and never comes back.
  await expect(dialog.getByRole("checkbox")).toHaveCount(2)
  for (const box of await dialog.getByRole("checkbox").all()) await box.check()
  await dialog.getByRole("button", { name: "שמירה והנחת כלנית" }).click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
  await expect(page.getByText("נשלח לבדיקה, ויופיע לכולם אחרי אישור.")).toBeVisible()
  return page
}

async function queued(b: Browser, name: string) {
  const ctx = await b.newContext()
  await ctx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const { items } = (await (await ctx.request.get("/api/admin/queue")).json()) as { items: { name_he: string }[] }
  return items.filter((i) => i.name_he === name).length
}

test("the sender follows a submission by its private link, from any browser, and withdraws it", async ({ browser }) => {
  test.setTimeout(90_000)
  const name = `ספסל דמו מעקב ${Date.now()}`
  const page = await submit(browser, name)

  // From the place's own card.
  await page.getByRole("button", { name: "מעקב אחרי ההצעה" }).click()
  const view = page.getByRole("dialog", { name: "מצב ההצעה" })
  await expect(view.getByText("ממתינה לבדיקה")).toBeVisible()
  await expect(view.getByText(name)).toBeVisible()
  const link = await view.getByLabel("קישור המעקב").inputValue()
  expect(link).toMatch(/#\/track\/p_[0-9A-Z]{26}\/[A-Za-z0-9_-]{22}$/)

  // The link opens the same view in a browser that never saw the place, and the token leaves the address bar.
  const other = await (await browser.newContext()).newPage()
  await other.goto(link.replace(/^https?:\/\/[^/]+/, ""))
  const there = other.getByRole("dialog", { name: "מצב ההצעה" })
  await expect(there.getByText("ממתינה לבדיקה")).toBeVisible(DAY)
  await expect(other).toHaveURL(/#\/$/)

  // Withdrawing asks first, then erases it: gone from the moderators' queue.
  await there.getByRole("button", { name: "משיכת ההצעה" }).click()
  await other.getByRole("alertdialog").getByRole("button", { name: "למשוך ולמחוק" }).click()
  await expect(there.getByText("נמשכה", { exact: false })).toBeVisible()
  expect(await queued(browser, name)).toBe(0)
})

test("a tracking link with a wrong token says nothing about the place", async ({ page }) => {
  await page.goto("/#/track/p_01ZZZZZZZZZZZZZZZZZZZZZZZZ/AAAAAAAAAAAAAAAAAAAAAA")
  await expect(page.getByRole("dialog", { name: "מצב ההצעה" }).getByText("לא מצאנו הצעה בקישור הזה")).toBeVisible(DAY)
})

test("a moderator returns a place with a note, the sender corrects it, and it comes back for review", async ({ browser }) => {
  test.setTimeout(120_000)
  const name = `ספסל דמו מוחזר ${Date.now()}`
  const page = await submit(browser, name)

  const modCtx = await browser.newContext()
  await modCtx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const mod = await modCtx.newPage()
  await mod.goto("/admin/")
  const item = mod.getByRole("article", { name })
  await item.getByRole("button", { name: "החזרה לתיקון" }).click()
  await item.getByLabel("הערה למגיש").fill("נא לציין את שם היישוב")
  await item.getByRole("button", { name: "שליחת ההחזרה" }).click()
  await expect(item).toHaveCount(0)

  await page.getByRole("button", { name: "מעקב אחרי ההצעה" }).click()
  const view = page.getByRole("dialog", { name: "מצב ההצעה" })
  await expect(view.getByText("הוחזרה אליכם לתיקון")).toBeVisible()
  await expect(view.getByText("נא לציין את שם היישוב")).toBeVisible()
  await view.getByRole("button", { name: "תיקון ההצעה" }).click()
  await view.getByLabel("יישוב או אזור").fill("בארי")
  await view.getByLabel("שם המקום").fill(`${name} מתוקן`)
  await view.getByRole("checkbox").check()
  await view.getByRole("button", { name: "שליחה מחדש לבדיקה" }).click()
  await expect(view.getByText("ממתינה לבדיקה")).toBeVisible()

  await mod.reload()
  const corrected = mod.getByRole("article", { name: `${name} מתוקן` })
  await expect(corrected).toBeVisible()
  await expect(corrected.getByText("בארי", { exact: false })).toBeVisible()
})

test("a correction whose answer was lost is found saved, not reported as unsent", async ({ browser }) => {
  test.setTimeout(120_000)
  const name = `ספסל דמו תיקון שאבד ${Date.now()}`
  const page = await submit(browser, name)
  const modCtx = await browser.newContext()
  await modCtx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const mod = await modCtx.newPage()
  await mod.goto("/admin/")
  const item = mod.getByRole("article", { name })
  await item.getByRole("button", { name: "החזרה לתיקון" }).click()
  await item.getByLabel("הערה למגיש").fill("נא לציין את שם היישוב")
  await item.getByRole("button", { name: "שליחת ההחזרה" }).click()
  await expect(item).toHaveCount(0)

  // The server saves the correction; its answer never reaches the browser.
  await page.route("**/api/v1/submissions/*/revisions", async (route) => {
    await route.fetch()
    await route.abort("failed")
  })
  await page.getByRole("button", { name: "מעקב אחרי ההצעה" }).click()
  const view = page.getByRole("dialog", { name: "מצב ההצעה" })
  await view.getByRole("button", { name: "תיקון ההצעה" }).click()
  await view.getByLabel("יישוב או אזור").fill("בארי")
  await view.getByRole("checkbox").check()
  await view.getByRole("button", { name: "שליחה מחדש לבדיקה" }).click()
  await expect(view.getByText("ממתינה לבדיקה")).toBeVisible()
  await expect(page.getByText("לא קיבלנו תשובה מהשרת")).toHaveCount(0)
  await expect(page.getByText("לא הצלחנו לשלוח את התיקון")).toHaveCount(0)
})

test("a withdrawal whose answer was lost is found done, not reported as unchanged", async ({ browser }) => {
  const name = `ספסל דמו משיכה שאבדה ${Date.now()}`
  const page = await submit(browser, name)
  await page.route("**/api/v1/submissions/*/withdraw", async (route) => {
    await route.fetch()
    await route.abort("failed")
  })
  await page.getByRole("button", { name: "מעקב אחרי ההצעה" }).click()
  const view = page.getByRole("dialog", { name: "מצב ההצעה" })
  await view.getByRole("button", { name: "משיכת ההצעה" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "למשוך ולמחוק" }).click()
  await expect(view.getByText("נמשכה", { exact: false })).toBeVisible()
  await expect(page.getByText("לא הצלחנו", { exact: false })).toHaveCount(0)
  // The device no longer keeps the tracking link of a withdrawn place.
  await expect
    .poll(() =>
      page.evaluate(
        (n) =>
          new Promise<unknown>((resolve) => {
            const req = indexedDB.open("makom-lizkor-v2")
            req.onsuccess = () => {
              const get = req.result.transaction("v1").objectStore("v1").get("local")
              get.onsuccess = () =>
                resolve(
                  (get.result as { name_he: string; local?: { trackingToken?: string } }[]).find((p) => p.name_he === n)?.local
                    ?.trackingToken,
                )
            }
          }),
        name,
      ),
    )
    .toBeUndefined()
})

/** A submission returned by the moderator, with its tracking view open on the correction form. */
async function returnedAndFixing(browser: Browser, name: string) {
  const page = await submit(browser, name)
  const modCtx = await browser.newContext()
  await modCtx.request.post("/__dev/login", { data: { email: "dev@example.test" } })
  const mod = await modCtx.newPage()
  await mod.goto("/admin/")
  const item = mod.getByRole("article", { name })
  await item.getByRole("button", { name: "החזרה לתיקון" }).click()
  await item.getByLabel("הערה למגיש").fill("נא לציין את שם היישוב")
  await item.getByRole("button", { name: "שליחת ההחזרה" }).click()
  await expect(item).toHaveCount(0)
  await page.getByRole("button", { name: "מעקב אחרי ההצעה" }).click()
  const view = page.getByRole("dialog", { name: "מצב ההצעה" })
  await view.getByRole("button", { name: "תיקון ההצעה" }).click()
  await view.getByLabel("יישוב או אזור").fill("בארי")
  await view.getByRole("checkbox").check()
  return { page, view, modCtx }
}

test("a correction saved before the server failed is found saved", async ({ browser }) => {
  test.setTimeout(120_000)
  const { page, view } = await returnedAndFixing(browser, `ספסל דמו תיקון ושגיאה ${Date.now()}`)
  await page.route("**/api/v1/submissions/*/revisions", async (route) => {
    await route.fetch()
    await route.fulfill({ status: 500, contentType: "application/problem+json", body: JSON.stringify({ status: 500, code: "internal" }) })
  })
  await view.getByRole("button", { name: "שליחה מחדש לבדיקה" }).click()
  await expect(view.getByText("ממתינה לבדיקה")).toBeVisible()
  await expect(page.getByText("התיקון לא נשמר", { exact: false })).toHaveCount(0)
})

test("when another window's different correction got in first, this one stays in the form", async ({ browser }) => {
  test.setTimeout(120_000)
  const { page, view } = await returnedAndFixing(browser, `ספסל דמו שני חלונות ${Date.now()}`)
  await page.route("**/api/v1/submissions/*/revisions", async (route) => {
    const sent = route.request().postDataJSON() as Record<string, unknown>
    // Another window sends its own correction first; this one's answer is lost.
    await page.request.post(route.request().url(), {
      headers: { ...route.request().headers() },
      data: { ...sent, place_he: "כפר עזה" },
    })
    await route.abort("failed")
  })
  await view.getByRole("button", { name: "שליחה מחדש לבדיקה" }).click()
  await expect(page.getByText("ההצעה השתנתה בינתיים", { exact: false }).first()).toBeVisible()
  await expect(view.getByLabel("יישוב או אזור")).toHaveValue("בארי")
})

test("a correction approved before its lost answer was checked is found saved", async ({ browser }) => {
  test.setTimeout(120_000)
  const name = `ספסל דמו תיקון שאושר ${Date.now()}`
  const { page, view, modCtx } = await returnedAndFixing(browser, name)
  await page.route("**/api/v1/submissions/*/revisions", async (route) => {
    await route.fetch()
    // A moderator approves it before the sender's browser looks again.
    const { items } = (await (await modCtx.request.get("/api/admin/queue")).json()) as {
      items: { id: string; rev: number; revisionId: string; name_he: string }[]
    }
    const item = items.find((i) => i.name_he === name)!
    await modCtx.request.post(`/api/admin/places/${item.id}/transitions`, {
      headers: { "Sec-Fetch-Site": "same-origin" },
      data: { action: "approve", revisionId: item.revisionId, expectedRev: item.rev },
    })
    await route.abort("failed")
  })
  await view.getByRole("button", { name: "שליחה מחדש לבדיקה" }).click()
  await expect(view.getByText("אושרה ומופיעה באתר")).toBeVisible()
  await expect(page.getByText("לא מופיע בשרת", { exact: false })).toHaveCount(0)
})

test("a correction with doubled spaces, saved but unanswered, is still recognised as this one", async ({ browser }) => {
  test.setTimeout(120_000)
  const { page, view } = await returnedAndFixing(browser, `ספסל דמו רווחים ${Date.now()}`)
  await view.getByLabel("כמה מילים על המקום (לא חובה)").fill("שורה  עם רווח כפול\n\n\n\nושורה אחרי שורות ריקות")
  await page.route("**/api/v1/submissions/*/revisions", async (route) => {
    await route.fetch()
    await route.abort("failed")
  })
  await view.getByRole("button", { name: "שליחה מחדש לבדיקה" }).click()
  // Recognised as this correction, the form closes; unrecognised, it stays open with the text.
  await expect(view.getByRole("button", { name: "שליחה מחדש לבדיקה" })).toHaveCount(0)
  await expect(view.getByText("ממתינה לבדיקה")).toBeVisible()
})

test("when another window's different correction got in first and this one is refused, this one stays in the form", async ({ browser }) => {
  test.setTimeout(120_000)
  const { page, view } = await returnedAndFixing(browser, `ספסל דמו סירוב בגלל חלון אחר ${Date.now()}`)
  await page.route("**/api/v1/submissions/*/revisions", async (route) => {
    const sent = route.request().postDataJSON() as Record<string, unknown>
    await page.request.post(route.request().url(), { headers: { ...route.request().headers() }, data: { ...sent, place_he: "כפר עזה" } })
    // This window's own request now meets the other's correction: a real 409.
    await route.continue()
  })
  await view.getByRole("button", { name: "שליחה מחדש לבדיקה" }).click()
  await expect(page.getByText("ההצעה השתנתה בינתיים", { exact: false }).first()).toBeVisible()
  await expect(view.getByLabel("יישוב או אזור")).toHaveValue("בארי")
})

test("a withdrawal whose photo erasure is still pending can be finished after a reload", async ({ browser }) => {
  test.setTimeout(120_000)
  const name = `ספסל דמו מחיקה תלויה ${Date.now()}`
  const page = await submit(browser, name)
  // The server withdraws it but can't erase its files yet (as R2 failing would leave it).
  await page.route("**/api/v1/submissions/*/withdraw", async (route) => {
    await route.fetch()
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "withdrawn", files: "pending" }) })
  })
  await page.route(/\/api\/v1\/submissions\/[^/]+$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    const res = await route.fetch()
    const body = (await res.json()) as Record<string, unknown>
    await route.fulfill({ response: res, json: body.status === "withdrawn" ? { ...body, files: "pending" } : body })
  })
  await page.getByRole("button", { name: "מעקב אחרי ההצעה" }).click()
  const view = page.getByRole("dialog", { name: "מצב ההצעה" })
  await view.getByRole("button", { name: "משיכת ההצעה" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "למשוך ולמחוק" }).click()
  await expect(view.getByText("התמונה כבר לא מוצגת", { exact: false })).toBeVisible()
  // After a reload the way back is still there: the address reopens the place's card, which still opens the tracking
  // view, and the view offers to finish.
  await page.reload()
  await page.getByRole("button", { name: "מעקב אחרי ההצעה" }).click()
  await expect(page.getByRole("dialog", { name: "מצב ההצעה" }).getByRole("button", { name: "להשלים את מחיקת התמונה" })).toBeVisible()
})
