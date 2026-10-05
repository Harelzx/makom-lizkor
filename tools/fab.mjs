import { chromium } from "playwright"
const b = await chromium.launch({ args: ["--enable-gpu", "--use-angle=metal"] })
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage()
await p.goto("http://localhost:5191/")
await p.evaluate(() => localStorage.setItem("makom-lizkor:v2-seen", "1"))
await p.reload()
await p.waitForTimeout(2500)
await p.getByRole("button", { name: "אל הבוקר" }).click()
await p.waitForTimeout(9000)
console.log(
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "הוספת מקום")
    if (!btn) return "no button"
    const r = btn.getBoundingClientRect()
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return { r: [r.x, r.y, r.width, r.height], hit: top?.outerHTML.slice(0, 160), visible: getComputedStyle(btn).visibility }
  }),
)
await b.close()
