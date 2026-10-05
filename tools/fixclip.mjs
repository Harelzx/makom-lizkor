// Before/after clip of the flower-offset fix, at phone size. Taps land where each flower is drawn.
import { chromium } from "playwright"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
const OUT = process.argv[2]
const TMP = process.argv[3]
const b = await chromium.launch({ args: ["--enable-gpu", "--use-angle=metal"] })
const TARGETS = [
  "אתר ההנצחה לנרצחי פסטיבל נובה",
  "עצים לזכרם – חורשת הנובה",
  'מיצב "כלניות לפני הגשם" באתר הנובה',
  "מיצג המכולה באתר הנובה",
]

async function take(mode) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const p = await ctx.newPage()
  await p.goto("http://localhost:5174/")
  await p.evaluate(() => localStorage.setItem("makom-lizkor:v2-seen", "1"))
  await p.reload()
  await p.waitForTimeout(2500)
  await p.getByRole("button", { name: "אל הבוקר" }).tap()
  await p.waitForTimeout(9000)
  await p.evaluate(() =>
    window.__map.jumpTo({
      center: [34.4703, 31.3978],
      zoom: 16.4,
      pitch: 35,
      bearing: 0,
      padding: { top: 60, bottom: 380, left: 0, right: 0 },
    }),
  )
  await p.waitForTimeout(3000)
  await p.evaluate((mode) => {
    // "before": put the sprite back the way it was, starting at the svg's center
    if (mode === "before")
      for (const u of document.querySelectorAll(".mk-bloom use")) for (const a of ["x", "y", "width", "height"]) u.removeAttribute(a)
    const badge = document.createElement("div")
    badge.textContent = mode === "before" ? "לפני התיקון" : "אחרי התיקון"
    badge.style.cssText = `position:fixed;top:84px;left:50%;transform:translateX(-50%);z-index:9999;padding:8px 18px;border-radius:999px;font:800 17px Heebo,sans-serif;color:#fff;background:${mode === "before" ? "#475569" : "#d71a33"};box-shadow:0 8px 24px -8px rgb(0 0 0/.4)`
    document.body.appendChild(badge)
    window.__tap = (x, y) => {
      const d = document.createElement("div")
      d.style.cssText = `position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;background:rgb(30 41 59/.35);border:2px solid #fff;z-index:9998;pointer-events:none;transition:transform .5s,opacity .5s`
      document.body.appendChild(d)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          d.style.transform = "scale(1.6)"
          d.style.opacity = "0"
        }),
      )
      setTimeout(() => d.remove(), 700)
    }
  }, mode)
  const cdp = await ctx.newCDPSession(p)
  const dir = `${TMP}/${mode}`
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const frames = []
  cdp.on("Page.screencastFrame", async (f) => {
    const file = `${dir}/f${String(frames.length).padStart(5, "0")}.jpg`
    writeFileSync(file, Buffer.from(f.data, "base64"))
    frames.push({ file, t: f.metadata.timestamp })
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {})
  })
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 780, maxHeight: 1688 })
  await p.waitForTimeout(1500)
  for (const name of TARGETS) {
    // tap the middle of the flower as it is drawn
    const pt = await p.evaluate((n) => {
      const u = document.querySelector(`.mk-flower[aria-label='${n}'] .mk-petals use`)?.getBoundingClientRect()
      return u && [u.x + u.width / 2, u.y + u.height / 2]
    }, name)
    if (!pt || pt[1] > 470 || pt[1] < 130) continue
    await p.evaluate(([x, y]) => window.__tap(x, y), pt)
    await p.touchscreen.tap(pt[0], pt[1])
    await p.waitForTimeout(3600)
  }
  await cdp.send("Page.stopScreencast")
  await ctx.close()
  const lines = []
  for (let i = 0; i < frames.length; i++)
    lines.push(
      `file '${frames[i].file}'`,
      `duration ${Math.max(0.001, i < frames.length - 1 ? frames[i + 1].t - frames[i].t : 0.5).toFixed(4)}`,
    )
  lines.push(`file '${frames.at(-1).file}'`)
  writeFileSync(`${dir}/list.txt`, lines.join("\n"))
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    `${dir}/list.txt`,
    "-vf",
    "fps=30,scale=780:1688,format=yuv420p",
    "-c:v",
    "libx264",
    "-crf",
    "20",
    `${TMP}/${mode}.mp4`,
  ])
}
await take("before")
await take("after")
await b.close()
// side by side, cut to the shorter one
execFileSync("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-i",
  `${TMP}/before.mp4`,
  "-i",
  `${TMP}/after.mp4`,
  "-filter_complex",
  "[0:v]pad=iw+16:ih:0:0:white[l];[l][1:v]hstack=shortest=1,scale=1176:-2,format=yuv420p[v]",
  "-map",
  "[v]",
  "-c:v",
  "libx264",
  "-crf",
  "20",
  "-movflags",
  "+faststart",
  OUT,
])
console.log("done", OUT)
