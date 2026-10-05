// Screencast frames of the panel around one interaction: node frames.mjs <outDir> <action>
import { chromium } from "playwright"
import { writeFileSync, mkdirSync } from "node:fs"
const [S, action = "back"] = process.argv.slice(2)
mkdirSync(S, { recursive: true })
const b = await chromium.launch({ args: ["--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
await p.goto("http://localhost:5191/")
await p.evaluate(() => localStorage.setItem("makom-lizkor:v2-seen", "1"))
await p.reload()
await p.waitForTimeout(2500)
await p.keyboard.press("Enter")
await p.waitForTimeout(9000)
if (action === "back") {
  await p.locator("aside li button").first().click()
  await p.waitForTimeout(2500)
}
const cdp = await ctx.newCDPSession(p)
let n = 0,
  t0 = 0
cdp.on("Page.screencastFrame", async (f) => {
  if (!t0) t0 = f.metadata.timestamp
  writeFileSync(
    `${S}/${action}-${String(n++).padStart(3, "0")}-${Math.round((f.metadata.timestamp - t0) * 1000)}ms.jpg`,
    Buffer.from(f.data, "base64"),
  )
  await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {})
})
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, everyNthFrame: 1 })
await p.waitForTimeout(300)
const tAct = Date.now()
if (action === "back") await p.keyboard.press("Escape")
if (action === "open") await p.locator("aside li button").first().click()
console.log("acted at", Date.now() - tAct)
await p.waitForTimeout(1200)
await cdp.send("Page.stopScreencast")
await b.close()
