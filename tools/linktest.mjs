// Shared place links skip the opening; the opening can be played again from "about".
import { chromium } from "playwright"
const S = process.argv[2]
const base = "http://localhost:5191"
const b = await chromium.launch({ args: ["--enable-gpu", "--use-angle=metal"] })
const ok = (c, m) => console.log(c ? "  ✓" : "  ✗ FAIL", m)
const errs = []
const introOn = (p) => p.locator("[aria-labelledby=intro-title], [role=dialog]:has(#intro-title)").count()

console.log("shared link, desktop (first visit)")
let p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
p.on("pageerror", (e) => errs.push(String(e)))
await p.goto(base + "/#/place/asaf-hamami-bridge-petah-tikva")
await p.waitForTimeout(600)
await p.screenshot({ path: `${S}/l1-early.png` })
await p.waitForTimeout(3400)
await p.screenshot({ path: `${S}/l2-landed.png` })
ok((await p.getByRole("button", { name: "אל הבוקר" }).count()) === 0, "no opening")
ok(!(await p.evaluate(() => document.documentElement.classList.contains("dark"))), "morning palette")
ok(
  (await p.locator("aside h2, aside h3").first().innerText()).length > 0,
  "card open: " +
    (await p
      .locator("aside article h2, aside article h3")
      .first()
      .innerText()
      .catch(() => "?")),
)
ok((await p.evaluate(() => location.hash)) === "#/place/asaf-hamami-bridge-petah-tikva", "hash kept")
await p.keyboard.press("Escape")
await p.waitForTimeout(1200)
ok((await p.getByRole("tab", { name: "קהילות" }).count()) === 1, "Esc goes to the list")

console.log("replay from about")
await p.getByRole("button", { name: "על הפרויקט" }).click()
await p.waitForTimeout(800)
await p.getByRole("button", { name: "צפייה בפתיחה שוב" }).click()
await p.waitForTimeout(500)
await p.screenshot({ path: `${S}/l3-replay-0.5s.png` })
await p.waitForTimeout(1500)
await p.screenshot({ path: `${S}/l4-replay-2s.png` })
ok((await p.locator("[aria-label='7 באוקטובר 2023']").count()) === 1, "date shown again (full opening)")
ok(await p.evaluate(() => document.documentElement.classList.contains("dark")), "night palette")
await p.waitForTimeout(2000)
await p.screenshot({ path: `${S}/l5-replay-4s.png` })
await p.keyboard.press("Enter")
await p.waitForTimeout(400)
await p.keyboard.press("Enter")
await p.waitForTimeout(2500)
await p.keyboard.press("Enter")
await p.waitForTimeout(9000)
await p.screenshot({ path: `${S}/l6-morning-again.png` })
ok((await p.evaluate(() => location.hash)) === "#/", "morning again, nothing selected")
ok((await p.getByRole("tab", { name: "קהילות" }).count()) === 1, "panel back")

console.log("shared link, phone")
p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage()
p.on("pageerror", (e) => errs.push("m " + String(e)))
await p.goto(base + "/#/place/community-beeri")
await p.waitForTimeout(4000)
await p.screenshot({ path: `${S}/l7-phone.png` })
ok((await p.getByRole("button", { name: "אל הבוקר" }).count()) === 0, "phone: no opening")

console.log("broken link")
p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
p.on("pageerror", (e) => errs.push("x " + String(e)))
await p.goto(base + "/#/place/no-such-place")
await p.waitForTimeout(3500)
await p.screenshot({ path: `${S}/l8-broken.png` })
ok((await p.evaluate(() => location.hash)) === "#/", "falls back to the overview")
ok((await p.getByRole("tab", { name: "קהילות" }).count()) === 1, "list shown")
console.log("errors:", errs.length ? errs : "none")
await b.close()
