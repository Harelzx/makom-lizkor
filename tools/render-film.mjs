// Renders the site's opening as a film, frame by frame, instead of recording the screen.
//
// The page runs on Playwright's clock: time moves only when this script moves it, one frame at a time, so every frame
// is exactly where the film is at that moment however slow the capture is, and nothing drops. CSS animations and
// transitions (which keep their own time) are paused and set to the same moment each frame. The sound is the site's
// own engine rendered offline: an OfflineAudioContext stands in for the AudioContext and reads the same clock, so the
// mix (score, cues, fades, the limiter) is what a visitor hears, sample-aligned with the picture.
//
//   node render-film.mjs desktop out.mp4 [--date 2026-10-05] [--fps 30] [--morning 37.6] [--until 47.6] [--from 0]
//   (--from: time still runs from the click, but frames are kept only from there: a quick look at one scene;
//    --age N: wait N real seconds before the click, to prove nothing reads the real clock; --debug: log new animations)
//
// Needs this checkout's preview server (http://localhost:5190 in the main checkout, its own port in a worktree; for window.__map) and ffmpeg. t = 0 is the click on «עם צליל».
import { chromium } from "playwright"
import { spawn, execFileSync } from "node:child_process"
import { writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { previewUrl } from "./paths.mjs"

const args = process.argv.slice(2)
const [which = "desktop", outArg = `opening-${which}.mp4`] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"))
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const out = resolve(outArg)
const fps = Number(opt("fps", 30))
const date = opt("date", "2026-10-05")
const morningAt = Number(opt("morning", 37.6))
const until = Number(opt("until", 47.6))
const from = Number(opt("from", 0))
const debug = args.includes("--debug")
const frames = Math.round(until * fps)
// desktop: a 1280×720 laptop at 1.5× → 1920×1080; phone: a 360×640 phone at 3× → 1080×1920
const view =
  which === "phone"
    ? { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 }
const size = { w: Math.round(view.viewport.width * view.deviceScaleFactor), h: Math.round(view.viewport.height * view.deviceScaleFactor) }

mkdirSync(dirname(out), { recursive: true })
const tmp = out.replace(/\.mp4$/, "")
const browser = await chromium.launch({ args: ["--use-gl=angle", "--enable-unsafe-swiftshader", "--hide-scrollbars"] })
const ctx = await browser.newContext({ ...view, reducedMotion: "no-preference" })
const page = await ctx.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
page.on("console", (m) => m.text().startsWith("render-film:") && console.log(m.text()))

// a morning in Israel on the film's date, before the clock is paused for the film itself
await page.clock.install({ time: new Date(`${date}T09:00:00+03:00`) })

await page.addInitScript(
  ({ seconds }) => {
    // The same film every run: the embers' places and the sounds' variations come from a fixed sequence.
    let seed = 0x7a1d
    Math.random = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    // The sound engine's AudioContext, rendered offline on the page's clock.
    class FilmAudioContext extends OfflineAudioContext {
      constructor() {
        super({ numberOfChannels: 2, length: Math.ceil(48000 * seconds), sampleRate: 48000 })
        this.__t0 = performance.now()
        window.__ac = this
      }
      get currentTime() {
        return (performance.now() - this.__t0) / 1000
      }
      resume() {
        return Promise.resolve()
      }
      suspend() {
        return Promise.resolve()
      }
    }
    window.AudioContext = FilmAudioContext
    // Nothing ends before an offline context renders, so the engine would never learn that a sound has finished (and
    // stops starting new ones after eight): each source tells it on the page's clock instead.
    const start = AudioBufferSourceNode.prototype.start
    const stop = AudioBufferSourceNode.prototype.stop
    const ended = (src, at) => {
      clearTimeout(src.__ending)
      src.__ending = setTimeout(
        () => {
          const handler = src.onended
          src.onended = null
          handler?.call(src, new Event("ended"))
        },
        Math.max(0, at - src.context.currentTime) * 1000,
      )
    }
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration) {
      const r = start.apply(this, arguments)
      if (this.context instanceof FilmAudioContext) {
        const now = this.context.currentTime
        this.__end = Math.max(when, now) + (duration ?? (this.buffer.duration - offset) / this.playbackRate.value)
        ended(this, this.__end)
      }
      return r
    }
    AudioBufferSourceNode.prototype.stop = function (when = 0) {
      const r = stop.apply(this, arguments)
      if (this.context instanceof FilmAudioContext && this.__end !== undefined)
        ended(this, Math.min(this.__end, Math.max(when, this.context.currentTime)))
      return r
    }

    // Animations started from script (motion's) are born paused and are moved only by the film: motion gives each a start
    // time from the page's clock, which the browser reads on its own real clock, so in a long render they were over
    // the moment they began (the words vanished, the papers never fell). Their play() and startTime belong to the film.
    const play = Animation.prototype.play
    const startTime = Object.getOwnPropertyDescriptor(Animation.prototype, "startTime")
    Object.defineProperty(Animation.prototype, "startTime", {
      ...startTime,
      set(v) {
        if (!this.__born) startTime.set.call(this, v)
      },
    })
    Animation.prototype.play = function () {
      if (!this.__born) return play.call(this)
    }
    const animate = Element.prototype.animate
    Element.prototype.animate = function () {
      const a = animate.apply(this, arguments)
      a.__born = performance.now()
      a.pause()
      a.currentTime = 0
      return a
    }
    // CSS animations and transitions keep their own time: each frame they are paused and set to where the film is.
    // Each keeps a clock of its own, which stands still while the page's CSS holds it paused (the embers at 06:29).
    const local = new Map()
    const done = new WeakSet()
    let last = null
    const heldByCss = (a) => {
      if (!(a instanceof CSSAnimation) || !a.effect?.target) return false
      const cs = getComputedStyle(a.effect.target, a.effect.pseudoElement ?? undefined)
      const names = cs.animationName.split(",").map((s) => s.trim())
      const states = cs.animationPlayState.split(",").map((s) => s.trim())
      const i = names.indexOf(a.animationName)
      return (states[i] ?? states.at(-1)) === "paused"
    }
    window.__animLog = []
    window.__syncAnimations = () => {
      const now = performance.now()
      for (const a of document.getAnimations()) {
        if (!local.has(a) && !done.has(a) && window.__debugAnims)
          window.__animLog.push({
            kind: a.constructor.name,
            name:
              a.animationName ??
              a.transitionProperty ??
              [...new Set((a.effect?.getKeyframes?.() ?? []).flatMap((k) => Object.keys(k)))]
                .filter((k) => !["offset", "easing", "composite", "computedOffset"].includes(k))
                .join(","),
            target: a.effect?.target?.className?.baseVal ?? a.effect?.target?.className ?? a.effect?.target?.tagName,
            state: a.playState,
            start: a.startTime,
            current: a.currentTime,
            timeline: document.timeline.currentTime,
            perf: now,
            end: a.effect?.getComputedTiming().endTime,
          })
      }
      const dt = last === null ? 0 : now - last
      last = now
      for (const a of document.getAnimations()) {
        // scroll-driven ones (the day's panel) follow scrolling, not time: they are left alone
        if (done.has(a) || (a.timeline && a.timeline !== document.timeline)) continue
        const t = a.__born !== undefined ? now - a.__born : local.has(a) ? local.get(a) + (heldByCss(a) ? 0 : dt) : 0
        local.set(a, t)
        const end = a.effect?.getComputedTiming().endTime ?? Infinity
        try {
          if (Number.isFinite(end) && t >= end) {
            // played to its end, so it finishes as it would have (and its animationend reaches React). Not play() at the
            // end: play() rewinds a finished animation to 0, and it played again on the real clock, a delay and all (the
            // line under the name vanished for three frames at 36.7 s, held at its first keyframe until it was over).
            done.add(a)
            a.finish()
          } else {
            a.pause()
            a.currentTime = t
          }
        } catch (error) {
          // one animation that can't be set is left to play on its own, and named, never the end of the film
          done.add(a)
          console.warn("render-film: left an animation alone:", a.animationName ?? a.id ?? a.constructor.name, String(error))
        }
      }
    }
  },
  { seconds: until + 4 },
)

const base = previewUrl
await page.goto(base)
await page.locator("time").waitFor()
await page.waitForLoadState("networkidle")
await page.evaluate(() => document.fonts.ready)
// the map's first view, and the headline photos the clock preloads
await page.waitForFunction(() => window.__map?.loaded() && window.__map.areTilesLoaded(), null, { timeout: 180000 })
await page.waitForTimeout(1500)
const now = await page.evaluate(() => Date.now())
await page.clock.pauseAt(now + 1000)

// React renders on a real-time message channel: after time moves, let it commit before looking
const settle = () =>
  page.evaluate(
    () =>
      new Promise((done) => {
        let n = 0
        const c = new MessageChannel()
        c.port1.onmessage = () => (++n < 3 ? c.port2.postMessage(0) : done())
        c.port2.postMessage(0)
      }),
  )
const clickButton = (name) =>
  page.evaluate((name) => {
    const b = [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === name)
    if (!b) throw new Error(`no button «${name}»`)
    b.click()
  }, name)

// a test aid: age the page's real clock before the film, so anything that still read it would show (as in a long render)
if (opt("age")) await page.waitForTimeout(Number(opt("age")) * 1000)
await clickButton("עם צליל")
// the sounds load and decode in real time while the film's clock stands still
await page.waitForFunction(() => window.__ac !== undefined, null, { timeout: 20000 })
await page.waitForTimeout(2500)
await settle()

const ffmpeg = spawn(
  "ffmpeg",
  [
    "-loglevel",
    "error",
    "-y",
    "-f",
    "image2pipe",
    "-framerate",
    String(fps),
    "-c:v",
    "png",
    "-i",
    "-",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "16",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    `${tmp}.video.mp4`,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
)
const write = (buf) => new Promise((done) => (ffmpeg.stdin.write(buf) ? done() : ffmpeg.stdin.once("drain", done)))

// The clock moves in whole milliseconds (a fraction is rounded up, and 8.33 ms steps ran the film 8% fast): each frame
// goes to its own millisecond, in four steps so React commits between them as it would in a browser.
const at = (f) => Math.round((f * 1000) / fps)
const sub = 4
let morningPressed = false
let waitedForTiles = 0
const t0 = Date.now()
for (let f = 0; f < frames; f++) {
  if (f > 0) {
    const ms = at(f) - at(f - 1)
    for (let k = 0; k < sub; k++) {
      await page.clock.runFor(Math.floor((ms * (k + 1)) / sub) - Math.floor((ms * k) / sub))
      await settle()
      await page.evaluate(() => window.__syncAnimations())
    }
  }
  const t = f / fps
  if (!morningPressed && t >= morningAt) {
    morningPressed = true
    await clickButton("אל הבוקר")
    await settle()
  }
  if (debug && t >= from) await page.evaluate(() => (window.__debugAnims = true))
  await page.evaluate(() => window.__syncAnimations())
  if (debug && t >= from)
    for (const e of await page.evaluate(() => window.__animLog.splice(0))) console.log(`t=${t.toFixed(3)}`, JSON.stringify(e))
  if (t < from) continue
  // tiles arrive in real time: wait for the ones this view needs, then draw the map at this moment
  const t1 = Date.now()
  await page.waitForFunction(() => !window.__map || window.__map.areTilesLoaded(), null, { timeout: 20000 }).catch(() => {})
  waitedForTiles += Date.now() - t1
  await page.evaluate(() => window.__map?.redraw())
  await settle()
  await page.evaluate(() => window.__syncAnimations())
  await write(await page.screenshot({ type: "png" }))
  if (f % (fps * 2) === 0)
    console.log(`${which} ${t.toFixed(1)} s · frame ${f}/${frames} · ${((Date.now() - t0) / 1000).toFixed(0)} s so far`)
}
ffmpeg.stdin.end()
await new Promise((done) => ffmpeg.on("close", done))
// the page's own clock at the last frame, against where the film says it is
const pageMs = await page.evaluate(() => performance.now() - window.__ac.__t0)
console.log(`last frame: page clock ${pageMs.toFixed(1)} ms, film ${at(frames - 1)} ms`)

// the sound, rendered now that the film has scheduled all of it
const wav = await page.evaluate(async () => {
  const buffer = await window.__ac.startRendering()
  const n = buffer.length
  const L = buffer.getChannelData(0)
  const R = buffer.getChannelData(1)
  const bytes = new DataView(new ArrayBuffer(44 + n * 4))
  const str = (o, s) => [...s].forEach((c, i) => bytes.setUint8(o + i, c.charCodeAt(0)))
  ;(str(0, "RIFF"), bytes.setUint32(4, 36 + n * 4, true), str(8, "WAVEfmt "), bytes.setUint32(16, 16, true))
  ;(bytes.setUint16(20, 1, true), bytes.setUint16(22, 2, true), bytes.setUint32(24, buffer.sampleRate, true))
  ;(bytes.setUint32(28, buffer.sampleRate * 4, true), bytes.setUint16(32, 4, true), bytes.setUint16(34, 16, true))
  ;(str(36, "data"), bytes.setUint32(40, n * 4, true))
  for (let i = 0; i < n; i++) {
    bytes.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 0x7fff, true)
    bytes.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 0x7fff, true)
  }
  const u = new Uint8Array(bytes.buffer)
  let s = ""
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
})
await browser.close()
writeFileSync(`${tmp}.audio.wav`, Buffer.from(wav, "base64"))
execFileSync("ffmpeg", [
  "-loglevel",
  "error",
  "-y",
  "-i",
  `${tmp}.video.mp4`,
  "-i",
  `${tmp}.audio.wav`,
  "-map",
  "0:v",
  "-map",
  "1:a",
  "-c:v",
  "copy",
  "-af",
  `atrim=start=${from},asetpts=PTS-STARTPTS,afade=t=out:st=${until - from - 1}:d=1`,
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-t",
  String(until - from),
  "-movflags",
  "+faststart",
  out,
])
console.log(
  `${which}: ${frames} frames at ${fps} fps in ${((Date.now() - t0) / 1000).toFixed(0)} s (${(waitedForTiles / 1000).toFixed(0)} s waiting for tiles) → ${out} · errors: ${errors.length ? errors.join(" | ") : "none"}`,
)
