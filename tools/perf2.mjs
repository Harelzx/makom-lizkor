// Measures: time to first paint of the opening, map load, requests, long tasks and dropped frames during the sunrise.
import { chromium } from "playwright"
const url = process.argv[2] ?? "http://localhost:5191/"
const mobile = process.argv[3] === "mobile"
const b = await chromium.launch({ args: ["--enable-gpu", "--use-angle=metal"] })
const ctx = await b.newContext(
  mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 } },
)
const p = await ctx.newPage()
if (mobile) {
  const cdp = await ctx.newCDPSession(p)
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
  await cdp.send("Network.enable")
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 60,
    downloadThroughput: (12 * 1024 * 1024) / 8,
    uploadThroughput: (4 * 1024 * 1024) / 8,
  })
}
let requests = 0,
  bytes = 0
p.on("requestfinished", async (r) => {
  requests++
  try {
    bytes += (await r.sizes()).responseBodySize
  } catch {}
})
if (process.env.CSS)
  await p.addInitScript(
    (css) =>
      document.addEventListener("DOMContentLoaded", () => {
        const s = document.createElement("style")
        s.textContent = css
        document.head.appendChild(s)
      }),
    process.env.CSS,
  )
await p.addInitScript(() => {
  window.__long = []
  new PerformanceObserver((l) =>
    l.getEntries().forEach((e) => window.__long.push([Math.round(e.startTime), Math.round(e.duration)])),
  ).observe({ type: "longtask", buffered: true })
  window.__frames = []
  let last = performance.now()
  const f = (t) => {
    window.__frames.push(t - last)
    last = t
    requestAnimationFrame(f)
  }
  requestAnimationFrame(f)
})
const t0 = Date.now()
await p.goto(url)
await p.waitForSelector("text=07.10.2023", { timeout: 30000 })
const tText = Date.now() - t0
await p
  .waitForFunction(() => document.querySelector(".maplibregl-canvas") && window.__map?.loaded?.() !== false, null, { timeout: 60000 })
  .catch(() => {})
await p.waitForTimeout(4000)
const before = await p.evaluate(() => ({ long: window.__long.length }))
await p.evaluate(() => {
  window.__frames = []
  window.__long = []
})
await p.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "דילוג")?.click())
await p.waitForTimeout(8000)
const dawn = await p.evaluate(() => {
  const f = window.__frames
  const avg = f.reduce((a, b) => a + b, 0) / f.length
  return {
    frames: f.length,
    fps: Math.round(1000 / avg),
    jank50: f.filter((x) => x > 50).length,
    worst: Math.round(Math.max(...f)),
    long: window.__long.length,
    longTotal: window.__long.reduce((a, [, d]) => a + d, 0),
  }
})
console.log(
  JSON.stringify({ mobile, textVisibleMs: tText, requests, MB: +(bytes / 1048576).toFixed(1), longTasksBeforeDawn: before.long, dawn }),
)
await b.close()
