import { chromium } from "playwright"
const b = await chromium.launch({ args: ["--enable-gpu", "--use-angle=metal"] })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
const p = await ctx.newPage()
const cdp = await ctx.newCDPSession(p)
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
await p.goto("http://localhost:5191/")
await p.waitForTimeout(6000)
await cdp.send("Profiler.enable")
await cdp.send("Profiler.setSamplingInterval", { interval: 1000 })
await cdp.send("Profiler.start")
await p.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "דילוג")?.click())
await p.waitForTimeout(8000)
const { profile } = await cdp.send("Profiler.stop")
// self time per function
const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const self = new Map()
const dt = profile.timeDeltas
profile.samples.forEach((id, i) => {
  const n = byId.get(id)
  const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`
  self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000)
})
console.log(
  [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([k, v]) => `${v.toFixed(0)}ms ${k}`)
    .join("\n"),
)
await b.close()
