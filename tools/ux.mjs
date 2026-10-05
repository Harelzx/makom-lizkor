import { chromium } from "playwright"
const S = process.argv[2]
const b = await chromium.launch({ args: ["--enable-gpu", "--use-angle=metal"] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errs = []
p.on("pageerror", (e) => errs.push(String(e)))
await p.goto("http://localhost:5191/")
await p.evaluate(() => localStorage.setItem("makom-lizkor:v2-seen", "1"))
await p.reload()
await p.waitForTimeout(2500)
await p.keyboard.press("Enter")
await p.waitForTimeout(8500)
// shared element: click the first list row with a photo, capture mid-flight
await p.locator("aside li button").first().click()
await p.waitForTimeout(180)
await p.screenshot({ path: `${S}/u1.png`, clip: { x: 1000, y: 0, width: 440, height: 600 } })
await p.waitForTimeout(1500)
await p.keyboard.press("Escape")
await p.waitForTimeout(900)
// hover preview on a flower with a photo
const box = await p.evaluate(() => {
  const el = [...document.querySelectorAll(".mk-flower")].find((x) => x.getAttribute("aria-label")?.includes("נובה"))
  const r = el?.getBoundingClientRect()
  return r && [r.x + r.width / 2, r.y + r.height / 2]
})
if (box) {
  await p.mouse.move(box[0], box[1])
  await p.waitForTimeout(500)
  await p.screenshot({ path: `${S}/u2.png`, clip: { x: Math.max(0, box[0] - 160), y: Math.max(0, box[1] - 60), width: 320, height: 220 } })
}
// collapse the panel
await p.getByRole("button", { name: /כיווץ הרשימה/ }).click()
await p.waitForTimeout(900)
await p.screenshot({ path: `${S}/u3.png` })
await p.getByRole("button", { name: /פתיחת הרשימה/ }).click()
await p.waitForTimeout(600)
// add flow: error shake + progress
await p.getByRole("button", { name: "הוספת מקום" }).first().click()
await p.waitForTimeout(900)
await p.getByRole("button", { name: "המשך" }).click()
await p.waitForTimeout(300)
await p.screenshot({ path: `${S}/u4.png` })
await p.keyboard.press("Escape")
await p.waitForTimeout(600)
// night switch with circular reveal
await p.getByRole("button", { name: "מעבר למצב לילה" }).click()
await p.waitForTimeout(320)
await p.screenshot({ path: `${S}/u5.png` })
await p.waitForTimeout(1500)
// slash opens search
await p.mouse.click(700, 500)
await p.keyboard.press("/")
await p.waitForTimeout(500)
console.log("search open:", await p.getByPlaceholder("מקום, יישוב, שם…").count())
console.log("errors:", errs)
await b.close()
