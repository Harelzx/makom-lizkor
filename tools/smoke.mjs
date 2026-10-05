import { chromium } from "playwright"
const b = await chromium.launch({ args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
p.on("console", (m) => m.type() === "error" && errs.push(m.text()))
p.on("pageerror", (e) => errs.push(String(e)))
await p.goto(process.argv[2] ?? "http://localhost:5180/")
await p.getByRole("button", { name: "דילוג למפה" }).click()
await p.waitForTimeout(6000)
await p.screenshot({ path: process.argv[3] ?? "/tmp/smoke.png" })
console.log("errors:", errs)
await b.close()
