// Records the v2 demo video and stills. Usage: node capture-v2.mjs [baseUrl] [all|stills|video]
// Frames come from the DevTools screencast with their real timestamps; ffmpeg assembles them at 30fps.
import { chromium } from "playwright"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { launch, previewUrl } from "./paths.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(launch, "v2")
const base = process.argv[2] ?? previewUrl
const what = process.argv[3] ?? "all"
const browser = await chromium.launch({ headless: true, args: ["--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"] })
const SEEN = () => localStorage.setItem("makom-lizkor:v2-seen", "1")

async function stills() {
  const d = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const p = await d.newPage()
  await p.goto(base + "/")
  await p.waitForTimeout(13500)
  await p.screenshot({ path: `${out}/still-1-intro.png` })
  await p.getByRole("button", { name: "אל הבוקר" }).click()
  await p.waitForTimeout(2600)
  await p.screenshot({ path: `${out}/still-2-sunrise.png` })
  await p.waitForTimeout(8000)
  await p.screenshot({ path: `${out}/still-3-morning.png` })
  await p.evaluate(() => (location.hash = "#/place/nova-memorial-reim"))
  await p.waitForTimeout(5000)
  await p.screenshot({ path: `${out}/still-4-place.png` })
  await p.evaluate(() => (location.hash = "#/place/community-kfar-aza"))
  await p.waitForTimeout(5000)
  await p.screenshot({ path: `${out}/still-5-community.png` })
  await p.getByRole("button", { name: "מעבר למצב לילה" }).click()
  await p.evaluate(() => (location.hash = "#/"))
  await p.waitForTimeout(400)
  await p
    .getByRole("button", { name: "כל הקהילות" })
    .click()
    .catch(() => {})
  await p.waitForTimeout(4500)
  await p.screenshot({ path: `${out}/still-6-night.png` })
  await d.close()

  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const mp = await m.newPage()
  await mp.goto(base + "/")
  await mp.evaluate(SEEN)
  await mp.reload()
  await mp.waitForTimeout(2500)
  await mp.screenshot({ path: `${out}/still-7-phone-intro.png` })
  await mp.getByRole("button", { name: "אל הבוקר" }).click()
  await mp.waitForTimeout(10000)
  await mp.screenshot({ path: `${out}/still-8-phone-map.png` })
  await mp.evaluate(() => (location.hash = "#/place/community-beeri"))
  await mp.waitForTimeout(5000)
  await mp.screenshot({ path: `${out}/still-9-phone-community.png` })
  await m.close()
}

async function video() {
  const W = +(process.env.W ?? 1600)
  const H = +(process.env.H ?? 900)
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  const p = await ctx.newPage()
  // Backdrop blur is the most expensive effect to composite in headless Chrome; the glass is opaque enough without it.
  if (process.env.NOBLUR)
    await p.addInitScript(() =>
      document.addEventListener("DOMContentLoaded", () => {
        const s = document.createElement("style")
        s.textContent = "*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}"
        document.head.appendChild(s)
      }),
    )
  await p.goto(base + "/")
  const cdp = await ctx.newCDPSession(p)
  const dir = path.join(here, "frames")
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir)
  const frames = []
  cdp.on("Page.screencastFrame", async (f) => {
    const file = path.join(dir, `f${String(frames.length).padStart(5, "0")}.jpg`)
    writeFileSync(file, Buffer.from(f.data, "base64"))
    frames.push({ file, t: f.metadata.timestamp })
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {})
  })
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 })

  await p.waitForTimeout(14000) // 06:29, the two lines, the name
  await p.getByRole("button", { name: "אל הבוקר" }).click()
  await p.waitForTimeout(9500) // the sunrise and the flowers opening
  // a list row grows into the place card
  await p.locator("aside li button").first().hover()
  await p.waitForTimeout(700)
  await p.locator("aside li button").first().click()
  await p.waitForTimeout(5000)
  await p.getByRole("button", { name: "השארת כלנית" }).click()
  await p.waitForTimeout(2200)
  await p.keyboard.press("Escape") // the photo settles back into its row
  await p.waitForTimeout(2600)
  await p.getByRole("tab", { name: "קהילות" }).click() // the 90% counts up
  await p.waitForTimeout(3200)
  await p.locator("aside li button", { hasText: "כפר עזה" }).first().click()
  await p.waitForTimeout(5500)
  await p.keyboard.press("Escape")
  await p.waitForTimeout(1800)
  const sw = await p.getByRole("button", { name: "מעבר למצב לילה" }).boundingBox()
  await p.mouse.move(sw.x + sw.width / 2, sw.y + sw.height / 2, { steps: 12 })
  await p.mouse.click(sw.x + sw.width / 2, sw.y + sw.height / 2) // night opens as a circle from the button
  await p.waitForTimeout(2600)
  await p.getByRole("tab", { name: "מסע 232" }).click()
  await p.waitForTimeout(900)
  await p.getByRole("button", { name: "יציאה למסע" }).click()
  await p.waitForTimeout(13000)

  await cdp.send("Page.stopScreencast")
  await ctx.close()

  const lines = []
  for (let i = 0; i < frames.length; i++) {
    const d = i < frames.length - 1 ? frames[i + 1].t - frames[i].t : 0.6
    lines.push(`file '${frames[i].file}'`, `duration ${Math.max(0.001, d).toFixed(4)}`)
  }
  lines.push(`file '${frames.at(-1).file}'`)
  writeFileSync(path.join(dir, "list.txt"), lines.join("\n"))
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    path.join(dir, "list.txt"),
    "-vf",
    `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p,fade=t=in:st=0:d=1`,
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "18",
    "-movflags",
    "+faststart",
    `${out}/makom-lizkor-demo.mp4`,
  ])
  rmSync(dir, { recursive: true, force: true })
  console.log("frames:", frames.length)
}

if (what !== "video") await stills()
if (what !== "stills") await video()
await browser.close()
console.log("done")
