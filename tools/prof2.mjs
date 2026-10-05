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
const parent = new Map()
profile.nodes.forEach((n) => (n.children ?? []).forEach((c) => parent.set(c, n.id)))
const stacks = new Map()
profile.samples.forEach((id, i) => {
  const n = byId.get(id)
  if (n.callFrame.functionName !== "readValueFromInstance") return
  let cur = id
  const chain = []
  for (let k = 0; k < 14 && cur; k++) {
    const nn = byId.get(cur)
    chain.push(nn.callFrame.functionName + ":" + nn.callFrame.url.split("/").pop().split("-")[0] + ":" + nn.callFrame.columnNumber)
    cur = parent.get(cur)
  }
  const key = chain.slice(1, 14).join(" < ")
  stacks.set(key, (stacks.get(key) ?? 0) + (dt[i] ?? 0) / 1000)
})
console.log(
  [...stacks.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => v.toFixed(0) + "ms " + k)
    .join("\n\n"),
)
await b.close()
