import { chromium } from "playwright"
const b = await chromium.launch({ args: ["--enable-gpu", "--use-angle=metal"] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const rows = []
p.on("requestfinished", async (r) => {
  try {
    const s = await r.sizes()
    rows.push([new URL(r.url()).host + new URL(r.url()).pathname.replace(/\/\d+\/\d+\/\d+.*/, "/{z}/{x}/{y}"), s.responseBodySize])
  } catch {}
})
await p.goto("http://localhost:5191/")
await p.waitForTimeout(6000)
await p.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "דילוג")?.click())
await p.waitForTimeout(9000)
const agg = {}
for (const [k, v] of rows) {
  const key = k.replace(/[^/]+\.(js|css|woff2|webp)$/, "*.$1")
  agg[key] ??= [0, 0]
  agg[key][0]++
  agg[key][1] += v
}
console.log(
  Object.entries(agg)
    .sort((a, b) => b[1][1] - a[1][1])
    .slice(0, 12)
    .map(([k, [n, v]]) => `${(v / 1024).toFixed(0)}KB x${n} ${k}`)
    .join("\n"),
)
await b.close()
