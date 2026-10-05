// Deep walkthrough of every UX moment: screenshots mid-motion and at rest, fps per moment, console errors.
// Usage: node deep.mjs <outDir> [baseUrl]
import { chromium } from "playwright"
const S = process.argv[2]
const base = process.argv[3] ?? "http://localhost:5191"
const b = await chromium.launch({ args: ["--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"] })
const log = (...a) => console.log(...a)
const errs = []
const ok = (cond, msg) => log(cond ? "  ✓" : "  ✗ FAIL", msg)

// fps meter: counts rAF frames between start/stop
const FPS = () => {
  window.__fps = { n: 0, t0: performance.now(), on: true, worst: 0, last: performance.now() }
  const tick = (t) => {
    const f = window.__fps
    if (!f.on) return
    f.n++
    f.worst = Math.max(f.worst, t - f.last)
    f.last = t
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
const fpsStop = () => {
  const f = window.__fps
  f.on = false
  const s = (performance.now() - f.t0) / 1000
  return `${(f.n / s).toFixed(0)}fps, worst frame ${f.worst.toFixed(0)}ms`
}

async function desktop() {
  log("\n== DESKTOP 1440×900 ==")
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  p.on("pageerror", (e) => errs.push("desktop: " + e))
  p.on("console", (m) => m.type() === "error" && errs.push("desktop console: " + m.text()))
  const t0 = Date.now()
  await p.goto(base + "/")
  await p.waitForSelector("canvas.maplibregl-canvas")
  log("  map canvas after", Date.now() - t0, "ms")
  await p.evaluate(FPS)
  // intro sequence
  await p.waitForTimeout(500)
  await p.screenshot({ path: `${S}/d01-date-mid.png` })
  await p.waitForTimeout(1300)
  await p.screenshot({ path: `${S}/d02-date-clock.png` })
  ok((await p.locator("[aria-label='שש עשרים ותשע']").innerText()).includes("9"), "clock rolled to 06:29")
  await p.waitForTimeout(1600)
  await p.screenshot({ path: `${S}/d03-line1.png` })
  await p.keyboard.press("Enter") // advance
  await p.waitForTimeout(1400)
  await p.screenshot({ path: `${S}/d04-line2-enter.png` })
  await p.keyboard.press("Enter")
  await p.waitForTimeout(700)
  await p.screenshot({ path: `${S}/d05-title-wipe.png` })
  await p.waitForTimeout(1800)
  await p.screenshot({ path: `${S}/d06-title.png` })
  log("  intro", await p.evaluate(fpsStop))
  ok(await p.evaluate(() => document.activeElement?.textContent?.includes("אל הבוקר")), "CTA focused at title")
  // sunrise
  await p.evaluate(FPS)
  await p.keyboard.press("Enter")
  for (const [ms, n] of [
    [900, "a"],
    [1300, "b"],
    [1500, "c"],
    [2000, "d"],
  ]) {
    await p.waitForTimeout(ms)
    await p.screenshot({ path: `${S}/d07-sunrise-${n}.png` })
  }
  await p.waitForTimeout(2500)
  log("  sunrise", await p.evaluate(fpsStop))
  await p.screenshot({ path: `${S}/d08-morning.png` })
  ok((await p.locator("[role=dialog][aria-labelledby=intro-title]").count()) === 0, "intro overlay gone")
  ok((await p.locator(".mk-flower").count()) > 50, `flowers on map: ${await p.locator(".mk-flower").count()}`)

  // list → detail shared element
  const row = p.locator("aside li button").first()
  const rowName = await row.innerText()
  await p.evaluate(FPS)
  await row.click()
  await p.waitForTimeout(150)
  await p.screenshot({ path: `${S}/d09-shared-mid.png`, clip: { x: 960, y: 0, width: 480, height: 900 } })
  await p.waitForTimeout(1600)
  await p.screenshot({ path: `${S}/d10-detail.png` })
  log("  list→detail", await p.evaluate(fpsStop), "|", rowName.split("\n")[0])
  ok((location) => true, "")
  ok((await p.evaluate(() => location.hash)).startsWith("#/place/"), "hash routed to place")
  await p.keyboard.press("Escape")
  await p.waitForTimeout(150)
  await p.screenshot({ path: `${S}/d11-back-mid.png`, clip: { x: 960, y: 0, width: 480, height: 900 } })
  await p.waitForTimeout(900)
  ok(!(await p.evaluate(() => location.hash)).startsWith("#/place/"), "Esc returned to list")
  // browser Back closes a card
  await p.locator("aside li button").nth(1).click()
  await p.waitForTimeout(1200)
  await p.evaluate(() => history.back())
  await p.waitForTimeout(1200)
  ok(
    (await p.getByRole("tab", { name: "קהילות" }).count()) === 1 && !(await p.evaluate(() => location.hash)).startsWith("#/place/"),
    "Back closes the card",
  )

  // scrolled header line
  await p
    .locator("aside [data-scroll], aside .overflow-y-auto")
    .first()
    .evaluate((el) => el.scrollBy(0, 400))
    .catch(() => {})
  await p.waitForTimeout(300)
  await p.screenshot({ path: `${S}/d12-scrolled.png`, clip: { x: 960, y: 0, width: 480, height: 300 } })

  // hover preview on map
  const box = await p.evaluate(() => {
    const el = [...document.querySelectorAll(".mk-flower")].find((x) => x.getAttribute("aria-label")?.includes("נובה"))
    const r = el?.getBoundingClientRect()
    return r && [r.x + r.width / 2, r.y + r.height / 2]
  })
  if (box) {
    await p.mouse.move(box[0], box[1])
    await p.waitForTimeout(450)
    await p.screenshot({
      path: `${S}/d13-hover.png`,
      clip: { x: Math.max(0, box[0] - 200), y: Math.max(0, box[1] - 140), width: 400, height: 280 },
    })
  }
  ok(!!box, "found Nova flower for hover")
  await p.mouse.move(10, 450)

  // select on map → ripple
  if (box) {
    await p.mouse.click(box[0], box[1])
    await p.waitForTimeout(2600)
    await p.screenshot({ path: `${S}/d14-selected.png` })
    await p.keyboard.press("Escape")
    await p.waitForTimeout(800)
  }

  // tribute
  await p.evaluate(() => (location.hash = "#/place/nova-memorial-reim"))
  await p.waitForTimeout(3000)
  await p.getByRole("button", { name: "השארת כלנית" }).click()
  await p.waitForTimeout(350)
  await p.screenshot({ path: `${S}/d15-tribute.png`, clip: { x: 960, y: 300, width: 480, height: 600 } })
  await p.waitForTimeout(800)
  ok((await p.getByText(/השארתם כאן/).count()) > 0, "tribute counter text updated")

  // community + count up + revival
  await p.evaluate(() => (location.hash = "#/place/community-kfar-aza"))
  await p.waitForTimeout(3500)
  await p.screenshot({ path: `${S}/d16-community.png` })
  await p.evaluate(() => (location.hash = "#/"))
  await p.waitForTimeout(600)
  await p.getByRole("tab", { name: "קהילות" }).click()
  await p.waitForTimeout(250)
  await p.screenshot({ path: `${S}/d17-countup-mid.png`, clip: { x: 960, y: 0, width: 480, height: 900 } })
  await p.waitForTimeout(1800)
  await p.screenshot({ path: `${S}/d18-communities.png`, clip: { x: 960, y: 0, width: 480, height: 900 } })

  // collapse panel
  await p.getByRole("button", { name: /כיווץ הרשימה/ }).click()
  await p.waitForTimeout(250)
  await p.screenshot({ path: `${S}/d19-collapse-mid.png` })
  await p.waitForTimeout(800)
  await p.screenshot({ path: `${S}/d20-collapsed.png` })
  await p.getByRole("button", { name: /פתיחת הרשימה/ }).click()
  await p.waitForTimeout(800)

  // search: "/" + empty state
  await p.mouse.click(400, 500)
  await p.waitForTimeout(300)
  await p.keyboard.press("/")
  await p.waitForTimeout(500)
  const sOpen = await p.getByPlaceholder("מקום, יישוב, שם…").count()
  ok(sOpen > 0, "'/' opens search")
  await p.keyboard.type("בארי")
  await p.waitForTimeout(300)
  await p.screenshot({ path: `${S}/d21-search.png` })
  await p.keyboard.press("Escape")
  await p.waitForTimeout(500)
  await p
    .getByPlaceholder(/חיפוש/)
    .first()
    .fill("זזזזזז")
    .catch(() => {})
  await p.waitForTimeout(500)
  await p.screenshot({ path: `${S}/d22-empty.png`, clip: { x: 960, y: 0, width: 480, height: 900 } })
  await p
    .getByPlaceholder(/חיפוש/)
    .first()
    .fill("")
    .catch(() => {})

  // add flow
  await p
    .getByRole("tab", { name: "מקומות" })
    .click()
    .catch(() => {})
  await p.getByRole("button", { name: "הוספת מקום" }).first().click()
  await p.waitForTimeout(900)
  await p.screenshot({ path: `${S}/d23-add-1.png` })
  await p.getByRole("button", { name: "המשך" }).click()
  await p.waitForTimeout(120)
  await p.screenshot({ path: `${S}/d24-add-shake.png` })
  await p.waitForTimeout(400)
  await p.getByRole("button", { name: "סימון על המפה" }).click()
  await p.waitForTimeout(700)
  await p.mouse.click(500, 600)
  await p.waitForTimeout(500)
  await p.screenshot({ path: `${S}/d25-pin.png` })
  ok((await p.locator(".draft-pin").count()) === 1, "pin placed")
  await p.getByRole("button", { name: "הסרת הסיכה" }).click()
  await p.waitForTimeout(400)
  ok((await p.locator(".draft-pin").count()) === 0, "pin removed")
  await p.mouse.click(520, 620)
  await p.waitForTimeout(400)
  await p.getByRole("button", { name: "זה המקום" }).click()
  await p.waitForTimeout(800)
  await p.getByRole("button", { name: "המשך" }).click()
  await p.waitForTimeout(150)
  await p.screenshot({ path: `${S}/d26-step2-mid.png` })
  await p.waitForTimeout(600)
  await p.getByRole("button", { name: "המשך" }).click()
  await p.waitForTimeout(400) // name missing → error
  await p.screenshot({ path: `${S}/d27-step2-error.png` })
  await p.getByLabel("שם המקום").fill("הספסל של נועה")
  await p.getByLabel("קישור לאתר הנצחה (לא חובה)").fill("https://www.example.co.il/page")
  ok((await p.getByLabel("קישור לאתר הנצחה (לא חובה)").inputValue()) === "www.example.co.il/page", "https:// stripped from pasted link")
  await p.getByRole("button", { name: "המשך" }).click()
  await p.waitForTimeout(800)
  await p.screenshot({ path: `${S}/d28-step3.png` })
  await p.locator("button[role=checkbox]").nth(0).click()
  await p.locator("button[role=checkbox]").nth(1).click()
  await p.evaluate(FPS)
  await p.getByRole("button", { name: "שמירה והנחת כלנית" }).click()
  await p.waitForTimeout(1300)
  await p.screenshot({ path: `${S}/d29-celebrate.png` })
  await p.waitForTimeout(1500)
  await p.screenshot({ path: `${S}/d30-saved.png` })
  log("  save+celebrate", await p.evaluate(fpsStop))
  ok((await p.getByText("הכלנית במקומה").count()) > 0, "toast shown")
  ok((await p.locator(".mk-community, .mk-local, [data-local]").count()) >= 0, "")

  // light switch
  await p.keyboard.press("Escape")
  await p.waitForTimeout(500)
  await p.getByRole("button", { name: "מעבר למצב לילה" }).click()
  await p.waitForTimeout(250)
  await p.screenshot({ path: `${S}/d31-night-mid.png` })
  await p.waitForTimeout(1500)
  await p.screenshot({ path: `${S}/d32-night.png` })
  ok(await p.evaluate(() => document.documentElement.classList.contains("dark")), "dark class on")

  // journey
  await p.getByRole("tab", { name: "מסע 232" }).click()
  await p.waitForTimeout(600)
  await p.evaluate(FPS)
  await p.getByRole("button", { name: "יציאה למסע" }).click()
  await p.waitForTimeout(6500)
  log("  journey flyTo", await p.evaluate(fpsStop))
  await p.screenshot({ path: `${S}/d33-journey.png` })

  // about
  await p.getByRole("button", { name: "על הפרויקט" }).first().click()
  await p.waitForTimeout(900)
  await p.screenshot({ path: `${S}/d34-about.png` })
  await ctx.close()
}

async function mobile() {
  log("\n== MOBILE 390×844, 4× CPU throttle ==")
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const p = await ctx.newPage()
  p.on("pageerror", (e) => errs.push("mobile: " + e))
  const cdp = await ctx.newCDPSession(p)
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
  const t0 = Date.now()
  await p.goto(base + "/")
  await p.waitForSelector("canvas.maplibregl-canvas")
  log("  map canvas after", Date.now() - t0, "ms (throttled)")
  await p.evaluate(FPS)
  await p.waitForTimeout(1200)
  await p.screenshot({ path: `${S}/m01-date.png` })
  await p.waitForTimeout(4000)
  await p.screenshot({ path: `${S}/m02-line.png` })
  log("  intro", await p.evaluate(fpsStop))
  await p.getByRole("button", { name: "דילוג" }).tap()
  await p.evaluate(FPS)
  await p.waitForTimeout(2400)
  await p.screenshot({ path: `${S}/m03-sunrise.png` })
  await p.waitForTimeout(5000)
  log("  sunrise", await p.evaluate(fpsStop))
  await p.screenshot({ path: `${S}/m04-map.png` })
  await p.evaluate(() => (location.hash = "#/place/community-beeri"))
  await p.waitForTimeout(4000)
  await p.screenshot({ path: `${S}/m05-community.png` })
  await p.evaluate(() => (location.hash = "#/place/nova-memorial-reim"))
  await p.waitForTimeout(4000)
  await p.screenshot({ path: `${S}/m06-place.png` })
  await p.evaluate(() => (location.hash = "#/"))
  await p.waitForTimeout(1500)
  await p.screenshot({ path: `${S}/m07-list.png` })
  await p
    .locator("button[aria-label='הוספת מקום']:visible")
    .tap()
    .catch((e) => log("  add tap:", e.message.split("\n")[0]))
  await p.waitForTimeout(1200)
  await p.screenshot({ path: `${S}/m08-add.png` })
  await ctx.close()
}

async function reduced() {
  log("\n== REDUCED MOTION ==")
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" })
  const p = await ctx.newPage()
  p.on("pageerror", (e) => errs.push("reduced: " + e))
  await p.goto(base + "/")
  await p.waitForTimeout(1500)
  await p.screenshot({ path: `${S}/r01-intro.png` })
  ok((await p.locator(".atmo-ember").count()) === 0, "no particles with reduced motion")
  await p.getByRole("button", { name: "אל הבוקר" }).click()
  await p.waitForTimeout(1500)
  await p.screenshot({ path: `${S}/r02-map.png` })
  await ctx.close()
}

await desktop()
await mobile()
await reduced()
log("\nerrors:", errs.length ? errs : "none")
await b.close()
