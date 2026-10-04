// The opening's sound. Off unless the visitor asks for it, and quiet when on. Nothing is fetched until sound is turned on
// (public/sound/, made with ElevenLabs). Two layers only, so it sounds like one film:
// - the score: one piece for felt piano and strings, composed in sections cut to the scenes (see CLAUDE.md);
// - real sound under it: the night air and the clock before 06:29, paper as the clippings rise, birds when time returns,
//   a typewriter key for every letter typed from the count to the name, and a sparkling whoosh that passes over the name
//   with the light.
// Never: sounds of the attack, voices, synthetic tones, or anything that breathes or gasps (that reads as horror).
//
// A bed is a loop that holds a scene; a cue is a single sound on a beat. Scenes say which bed they want, and where the
// score should be, whether sound is on or not, so turning it on midway plays what the scene is already in.

export type Bed = "night" | "dawn"
export type Cue = "tick" | "rise" | "rush" | "sweep" | "key" | "space"
type Name = Bed | Cue

/** The files behind each sound; a cue with several plays one of them at random, so a repeated beat never sounds copied. */
const FILES: Record<Name, string[]> = {
  night: ["night"],
  dawn: ["dawn"],
  tick: ["tick"],
  rise: ["rise-1", "rise-2", "rise-3"],
  rush: ["rush"],
  sweep: ["sweep"],
  key: ["key-1", "key-2", "key-3", "key-4", "key-5"],
  space: ["space"],
}
const SCORE = "score"
// The mix is in the files themselves (levels in CLAUDE.md).
/** Each pass of a bed overlaps the next by this long. MP3 pads a file with silence at both ends, so a bed looped the
 * plain way would gap every few seconds; overlapped and crossfaded, the padding is never heard. */
const OVERLAP = 0.8
/** The score moves only when it has drifted further than this from where the scene is, so it never stutters. */
const DRIFT = 0.4

const PREFERENCE = "makom-lizkor:sound"

let ctx: AudioContext | null = null
let out: GainNode | null = null
let on = false
let wanted: Bed | null = null
let bed: { name: Bed; gain: GainNode; sources: AudioBufferSourceNode[]; timer: number } | null = null
let score: { src: AudioBufferSourceNode; gain: GainNode; zero: number } | null = null
let scoreClock: (() => number | null) | null = null
let loading: Promise<void> | null = null
let voices = 0
const buffers = new Map<string, AudioBuffer>()
const listeners = new Set<() => void>()

/** What the visitor chose last time, if anything. */
export function soundPreference(): "on" | "off" | null {
  try {
    const v = localStorage.getItem(PREFERENCE)
    return v === "on" || v === "off" ? v : null
  } catch {
    return null
  }
}
function remember(v: "on" | "off") {
  try {
    localStorage.setItem(PREFERENCE, v)
  } catch {
    /* private mode: the choice lasts this visit */
  }
}

export const isSoundOn = () => on
export function subscribeSound(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
const changed = () => listeners.forEach((fn) => fn())

function load(): Promise<void> {
  const c = ctx
  if (!c) return Promise.resolve()
  loading ??= Promise.all(
    [...Object.values(FILES).flat(), SCORE].map(async (file) => {
      try {
        const res = await fetch(`/sound/${file}.mp3`)
        if (!res.ok) return
        buffers.set(file, await c.decodeAudioData(await res.arrayBuffer()))
      } catch {
        // a sound that can't load is a sound left out; the film goes on without it
      }
    }),
  ).then(() => undefined)
  return loading
}

/**
 * Turns sound on. Call it from the visitor's click: a browser lets a page make sound only from inside one.
 * Resolves once the sounds are ready, or after a moment if the network is slow, so the film never waits long.
 */
export function enableSound(): Promise<void> {
  if (!("AudioContext" in window)) return Promise.resolve()
  ctx ??= new AudioContext()
  if (!out) {
    out = ctx.createGain()
    // the race to today stacks many rustles on the score: a gentle limiter keeps the sum from ever clipping
    const limit = new DynamicsCompressorNode(ctx, { threshold: -6, knee: 6, ratio: 12, attack: 0.003, release: 0.25 })
    out.connect(limit).connect(ctx.destination)
  }
  void ctx.resume()
  out.gain.cancelScheduledValues(ctx.currentTime)
  out.gain.setTargetAtTime(1, ctx.currentTime, 0.05)
  on = true
  remember("on")
  changed()
  const ready = load().then(() => {
    playBed(wanted, 1.5)
    syncScore()
  })
  return Promise.race([ready, new Promise<void>((done) => setTimeout(done, 800))])
}

export function disableSound() {
  remember("off")
  if (!on) return
  on = false
  changed()
  if (!ctx || !out) return
  out.gain.cancelScheduledValues(ctx.currentTime)
  out.gain.setTargetAtTime(0, ctx.currentTime, 0.08)
  stopBed(0.4)
  stopScore(0.4)
}

/** The bed the scene is in: a crossfade over `fade` seconds, or a cut when `fade` is tiny (time stopping). */
export function setBed(name: Bed | null, fade = 1.5) {
  wanted = name
  if (on) playBed(name, fade)
}

/** Equal-power fades for the overlap: the two passes together keep the bed's level steady. */
const FADE_IN = Float32Array.from({ length: 32 }, (_, i) => Math.sin(((i / 31) * Math.PI) / 2))
const FADE_OUT = FADE_IN.slice().reverse()

function playBed(name: Bed | null, fade: number) {
  const c = ctx
  if (!c || !out || bed?.name === name) return
  stopBed(fade)
  const buffer = name && buffers.get(FILES[name][0])
  if (!name || !buffer) return
  const gain = c.createGain()
  gain.gain.value = 0
  gain.gain.setTargetAtTime(1, c.currentTime, fade / 3)
  gain.connect(out)
  const current = { name, gain, sources: [] as AudioBufferSourceNode[], timer: 0 }
  const step = buffer.duration - OVERLAP
  let at = c.currentTime
  // passes are scheduled a little ahead, each fading in over the last one's fade out
  const ahead = () => {
    while (at < c.currentTime + step * 1.5) {
      const src = c.createBufferSource()
      src.buffer = buffer
      const pass = c.createGain()
      pass.gain.setValueCurveAtTime(FADE_IN, at, OVERLAP)
      pass.gain.setValueCurveAtTime(FADE_OUT, at + buffer.duration - OVERLAP, OVERLAP)
      src.connect(pass).connect(gain)
      src.start(at)
      src.stop(at + buffer.duration)
      src.onended = () => {
        const i = current.sources.indexOf(src)
        if (i >= 0) current.sources.splice(i, 1)
      }
      current.sources.push(src)
      at += step
    }
    current.timer = window.setTimeout(ahead, step * 500)
  }
  ahead()
  bed = current
}

function stopBed(fade: number) {
  if (!bed || !ctx) return
  const { gain, sources, timer } = bed
  bed = null
  clearTimeout(timer)
  const t = Math.max(fade, 0.01)
  gain.gain.cancelScheduledValues(ctx.currentTime)
  gain.gain.setTargetAtTime(0, ctx.currentTime, t / 3)
  for (const src of sources) src.stop(ctx.currentTime + t * 2)
}

/**
 * Where the score should be right now, in seconds into it: negative while it hasn't started yet, null for no score.
 * The opening sets this from its scenes; the score follows it.
 */
export function setScoreClock(clock: (() => number | null) | null) {
  scoreClock = clock
  syncScore()
}

/** Puts the score where the scene says it should be: started, scheduled, moved with a crossfade, or stopped. */
export function syncScore(fade = 0.6) {
  const c = ctx
  const buffer = buffers.get(SCORE)
  if (!on || !c || !out || !buffer) return
  const at = scoreClock?.() ?? null
  if (at === null || at >= buffer.duration) {
    stopScore(fade)
    return
  }
  // already there, give or take: leave it alone
  if (score && Math.abs(c.currentTime - score.zero - at) < DRIFT) return
  stopScore(fade)
  const src = c.createBufferSource()
  src.buffer = buffer
  const gain = c.createGain()
  src.connect(gain).connect(out)
  const offset = Math.max(0, at)
  const when = c.currentTime + Math.max(0, -at)
  // from its start it comes in as composed; picked up midway, it fades in
  gain.gain.value = offset > 0 ? 0 : 1
  if (offset > 0) gain.gain.setTargetAtTime(1, when, fade / 3)
  src.start(when, offset)
  score = { src, gain, zero: when - offset }
}

export function stopScore(fade = 0.6) {
  if (!score || !ctx) return
  const { src, gain } = score
  score = null
  const t = Math.max(fade, 0.01)
  gain.gain.cancelScheduledValues(ctx.currentTime)
  gain.gain.setTargetAtTime(0, ctx.currentTime, t / 3)
  src.stop(ctx.currentTime + t * 2)
}

/** A single sound on a beat, `delay` seconds from now. Silent while sound is off, and when too many are already sounding. */
export function cue(name: Cue, delay = 0) {
  if (!on || !ctx || !out || voices >= 8) return
  const files = FILES[name]
  const buffer = buffers.get(files[Math.floor(Math.random() * files.length)])
  if (!buffer) return
  const src = ctx.createBufferSource()
  src.buffer = buffer
  // the rising clippings come many and fast: each a little higher or lower, so they read as paper, not a loop
  if (name === "rise") src.playbackRate.value = 0.92 + Math.random() * 0.16
  // and the keys, a hair either way, so a line of typing never repeats itself
  if (name === "key") src.playbackRate.value = 0.96 + Math.random() * 0.08
  src.connect(out)
  voices++
  src.onended = () => voices--
  src.start(ctx.currentTime + delay)
}

// A hidden tab goes quiet, and picks up where it was when it comes back.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!ctx || !on) return
    void (document.hidden ? ctx.suspend() : ctx.resume())
  })
}
