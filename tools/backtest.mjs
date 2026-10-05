// Back closes a card on a phone, and ends a running journey.
import { chromium } from "playwright"
const b = await chromium.launch({ args: ["--enable-gpu", "--use-angle=metal"] })
const ok = (c, m) => console.log(c ? "  ✓" : "  ✗ FAIL", m)
const m = await (
  await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
).newPage()
await m.goto("http://localhost:5191/")
await m.evaluate(() => localStorage.setItem("makom-lizkor:v2-seen", "1"))
await m.reload()
await m.waitForTimeout(2000)
await m.getByRole("button", { name: "אל הבוקר" }).tap()
await m.waitForTimeout(8500)
await m.locator("li button").first().tap()
await m.waitForTimeout(1500)
ok((await m.evaluate(() => location.hash)).startsWith("#/place/"), "phone: card open")
await m.goBack()
await m.waitForTimeout(1500)
ok(
  !(await m.evaluate(() => location.hash)).startsWith("#/place/") && (await m.getByRole("tab", { name: "קהילות" }).count()) === 1,
  "phone: Back returns to the list",
)
ok(m.url().startsWith("http://localhost:5191"), "phone: still on the site")
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.goto("http://localhost:5191/")
await p.evaluate(() => localStorage.setItem("makom-lizkor:v2-seen", "1"))
await p.reload()
await p.waitForTimeout(2000)
await p.keyboard.press("Enter")
await p.waitForTimeout(8500)
await p.getByRole("tab", { name: "מסע 232" }).click()
await p.waitForTimeout(500)
await p.getByRole("button", { name: "יציאה למסע" }).click()
await p.waitForTimeout(3000)
await p.goBack()
await p.waitForTimeout(10500) // longer than one stop's dwell
ok((await p.getByRole("button", { name: "יציאה למסע" }).count()) === 1, "journey: Back ends the journey")
ok(!(await p.evaluate(() => location.hash)).startsWith("#/place/"), "journey: no stop re-selected after Back")
await b.close()
