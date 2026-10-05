// Renders launch/v2/cover.html to launch/v2/cover-1200x627.png and this checkout's public/og.png.
import { chromium } from "playwright"
import { copyFileSync } from "node:fs"
import path from "node:path"
import { launch, repo } from "./paths.mjs"

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 627 }, deviceScaleFactor: 2 })
await page.goto("file://" + path.join(launch, "v2/cover.html"))
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(400)
const out = path.join(launch, "v2/cover-1200x627.png")
await page.locator(".cover").screenshot({ path: out })
copyFileSync(out, path.join(repo, "public/og.png"))
await browser.close()
