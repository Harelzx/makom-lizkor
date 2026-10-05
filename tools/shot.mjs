// Quick visual QA: node shot.mjs <url> <out.png> [w] [h] [steps-json]
// steps: [{"click":"text"}, {"wait":ms}, {"eval":"js"}, {"key":"Escape"}]
import { chromium } from "playwright"

const [url, out, w = "1440", h = "900", stepsJson = "[]"] = process.argv.slice(2)
const mobile = +w < 600
const browser = await chromium.launch({ args: ["--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"] })
const ctx = await browser.newContext({
  viewport: { width: +w, height: +h },
  deviceScaleFactor: mobile ? 2 : 1,
  isMobile: mobile,
  hasTouch: mobile,
})
const page = await ctx.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.type() === "error" && !/404|Failed to load resource/.test(m.text()) && errors.push(m.text()))
await page.goto(url)
for (const s of JSON.parse(stepsJson)) {
  if (s.click)
    await page
      .getByRole("button", { name: s.click, exact: s.exact ?? false })
      .first()
      .click({ timeout: 8000 })
  if (s.text) await page.getByText(s.text, { exact: false }).first().click({ timeout: 8000 })
  if (s.wait) await page.waitForTimeout(s.wait)
  if (s.eval) await page.evaluate(s.eval)
  if (s.key) await page.keyboard.press(s.key)
  if (s.shot) await page.screenshot({ path: s.shot })
}
await page.screenshot({ path: out })
if (errors.length) console.log("errors:", errors.slice(0, 5))
await browser.close()
