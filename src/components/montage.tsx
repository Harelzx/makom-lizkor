import { memo, useEffect, useMemo, useState } from "react"
import { animate, AnimatePresence, motion, useMotionValue, useMotionValueEvent, useTransform } from "motion/react"
import { HEADLINES, type Headline } from "@/data/headlines"
import { useStore } from "@/store"
import { dayOf } from "@/lib/since"
import { cn } from "@/lib/utils"
import { ease, rush } from "@/lib/motion"

/**
 * The opening's count, told in headlines. While the days run, every day that changed something brings a clipping up
 * from the depth, from behind the number, out to its place: slowly at first, then faster and faster, until the count
 * lands on today and everything stops. Nothing hits or shakes: the build-up is the pace and the pile, never force.
 * Then the camera rushes in through the pile toward the words: the clippings sweep past it to the edges and beyond,
 * dimmed and drifting, and the words come forward in the middle. When they say we won't forget, each clipping falls onto a memorial site on the map and lights up there.
 *
 * count: the days run and the clippings land · float: the pile waits behind the words · fall: onto the map
 *
 * Smoothness: only transform and opacity move (the darkening is a layer, never a filter), the photos are small
 * and decoded before the count starts, and the map underneath is held still the whole time, so it draws nothing.
 */
export type MontageMode = "count" | "float" | "fall"
export interface CountTiming {
  /** when the number fades in */
  enter: number
  /** when it starts to run */
  delay: number
  seconds: number
}

/**
 * Where each clipping lands, in percent of the screen, and its tilt. The later ones land on the earlier: a pile, not a grid.
 * The first ones take the strong places around the count; the last, in the race to today, flood the edges and corners.
 * All of them keep clear of the count and the clock, the skip button, the map credits (bottom left) and the dots.
 */
const DESKTOP = [
  { x: 24, y: 28, r: -4 },
  { x: 76, y: 25, r: 3 },
  { x: 21, y: 72, r: 2.5 },
  { x: 78, y: 73, r: -3 },
  { x: 50, y: 13, r: -1.5 },
  { x: 50, y: 84, r: 2 },
  { x: 15, y: 50, r: -2 },
  { x: 85, y: 49, r: 3.5 },
  { x: 25, y: 35, r: 6 },
  { x: 73, y: 31, r: -5 },
  { x: 25, y: 66, r: -4 },
  { x: 74, y: 67, r: 5 },
  { x: 44, y: 17, r: 3 },
  { x: 58, y: 81, r: -3 },
  { x: 15, y: 41, r: 4 },
  { x: 85, y: 58, r: -4 },
  { x: 31, y: 21, r: -2 },
  { x: 10, y: 17, r: -3 },
  { x: 90, y: 15, r: 4 },
  { x: 9, y: 76, r: 3 },
  { x: 90, y: 85, r: -2.5 },
  { x: 36, y: 7, r: 2 },
  { x: 64, y: 8, r: -3 },
  { x: 70, y: 91, r: 3 },
  { x: 7, y: 61, r: -4 },
  { x: 93, y: 37, r: 3 },
  { x: 11, y: 33, r: 5 },
  { x: 89, y: 68, r: -5 },
  { x: 57, y: 21, r: 1.5 },
  { x: 42, y: 80, r: -1.5 },
  { x: 81, y: 6, r: -3.5 },
  { x: 22, y: 10, r: 2 },
]
// On a phone the count holds the middle; the clippings fill above and below it, clear of the dots and the map credits.
const PHONE = [
  { x: 33, y: 13, r: -3 },
  { x: 67, y: 22, r: 3 },
  { x: 34, y: 70, r: 2 },
  { x: 66, y: 79, r: -2 },
  { x: 50, y: 7, r: -1 },
  { x: 64, y: 66, r: -4 },
  { x: 36, y: 26, r: 4 },
  { x: 44, y: 82, r: 2 },
  { x: 38, y: 17, r: 5 },
  { x: 60, y: 74, r: -3 },
  { x: 70, y: 9, r: 3 },
  { x: 30, y: 31, r: -3 },
  { x: 68, y: 34, r: 2 },
  { x: 30, y: 78, r: 3 },
  { x: 70, y: 73, r: -2 },
  { x: 52, y: 20, r: -4 },
]
/** The camera creeps in while the days pile up; the deeper a layer, the more it moves, so the pile has depth. */
const LAYER_ZOOM = [1.03, 1.06, 1.1]
/** Once the count lands it rushes in toward the words, and the pile sweeps past the camera to the edges and beyond. */
const RUSH_ZOOM = [1.75, 2.1, 2.5]
/** The count starts slow and races: a clipping lands when the count passes its day, so they come faster and faster. */
const RACE = (t: number) => t ** 2

/** The rise's easing: it leaves the depth quickly and slows into its place, never past it. */
const RISE = [0.2, 0.65, 0.25, 1] as const

const formatDate = (iso: string) => iso.split("-").reverse().join(".")

type Slot = { x: number; y: number; r: number }

/** How far clipping `i` travels to its site, measured inside its layer, zoomed by `z`. */
function fallOf(i: number, targets: { x: number; y: number }[] | null, slots: Slot[], z: number) {
  const t = targets?.[i]
  if (!t) return null
  const cx = window.innerWidth / 2
  const cy = window.innerHeight / 2
  const px = (slots[i].x / 100) * window.innerWidth
  const py = (slots[i].y / 100) * window.innerHeight
  return { x: cx + (t.x - cx) / z - px, y: cy + (t.y - cy) / z - py }
}

/** Photos decoded and ready to show; a clipping whose photo isn't here yet lands without it. */
const decoded = new Set<string>()

/** Fetches and decodes the photos ahead of the count, unless the visitor saves data or the connection is slow. */
export function preloadPhotos() {
  const net = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (net?.saveData || /2g/.test(net?.effectiveType ?? "")) return
  for (const h of HEADLINES) {
    if (!h.photo) continue
    const file = h.photo.file
    const img = new Image()
    img.src = `/headlines/${file}`
    img.decode().then(
      () => decoded.add(file),
      () => {},
    )
  }
}

export function Montage({ mode, days, count }: { mode: MontageMode; days: number; count: CountTiming }) {
  const [phone] = useState(() => window.matchMedia("(max-width: 767px)").matches)
  const slots = phone ? PHONE : DESKTOP
  // only what had happened by today, and on a phone only the sixteen that matter most
  const items = useMemo(
    () =>
      HEADLINES.map((h) => ({ h, day: dayOf(h.date) }))
        .filter(({ h, day }) => day > 0 && day < days && (!phone || h.phone))
        .slice(0, slots.length),
    [days, phone, slots.length],
  )

  // The count runs only in its own scene; leaving it early keeps whatever has landed.
  // The number is a motion value written straight to the page: React hears of it only when a clipping lands.
  const value = useMotionValue(0)
  const shown = useTransform(value, (v) => Math.round(v).toLocaleString("he-IL"))
  const [landed, setLanded] = useState(0)
  const [today, setToday] = useState(false)
  useMotionValueEvent(value, "change", (v) => {
    const day = Math.round(v)
    setLanded(items.filter((it) => it.day <= day).length)
    setToday(day >= days)
  })
  useEffect(() => {
    if (mode !== "count") return
    const c = animate(value, days, { delay: count.delay, duration: count.seconds, ease: RACE })
    return () => c.stop()
  }, [mode, days, count, value])

  // The camera: creeping in through the count, rushing in toward the words, and still from the moment the fall begins,
  // so the fall can aim at where the sites are. Each layer's zoom is a motion value, read when the fall is aimed.
  const z0 = useMotionValue(1)
  const z1 = useMotionValue(1)
  const z2 = useMotionValue(1)
  const zooms = useMemo(() => [z0, z1, z2], [z0, z1, z2])
  useEffect(() => {
    if (mode === "fall") return
    const to = mode === "count" ? LAYER_ZOOM : RUSH_ZOOM
    const how =
      mode === "count" ? { duration: count.delay + count.seconds, ease: "linear" as const } : { duration: rush.seconds, ease: rush.ease }
    const moves = zooms.map((z, layer) => animate(z, to[layer], how))
    return () => moves.forEach((m) => m.stop())
  }, [mode, zooms, count])

  // When time comes back, each clipping is given a memorial site in view to fall onto, spread left to right.
  const [targets, setTargets] = useState<{ x: number; y: number }[] | null>(null)
  useEffect(() => {
    if (mode !== "fall") return
    let live = true
    void import("@/map/controller").then((m) => {
      const w = window.innerWidth
      const h = window.innerHeight
      const sites = useStore
        .getState()
        .seed.filter((p) => p.kind !== "community")
        .map((p) => [p.lng, p.lat] as [number, number])
      const inView = m
        .screenPoints(sites)
        .filter((p) => p.x > 24 && p.x < w - 24 && p.y > 90 && p.y < h - 90)
        .sort((a, b) => a.x - b.x)
      const byX = items.map((_, i) => i).sort((a, b) => slots[a].x - slots[b].x)
      const out: { x: number; y: number }[] = []
      const used = new Map<number, number>()
      byX.forEach((i, k) => {
        const at = inView.length ? Math.floor(((k + 0.5) / byX.length) * inView.length) : -1
        const p = at >= 0 ? inView[at] : { x: w / 2, y: h * 0.72 }
        // when there are fewer places in view than headlines, the extra ones settle around the place, not on top of it
        const n = used.get(at) ?? 0
        used.set(at, n + 1)
        const angle = n * 2.4
        out[i] = { x: p.x + Math.cos(angle) * 16 * Math.sqrt(n), y: p.y + Math.sin(angle) * 16 * Math.sqrt(n) }
      })
      if (live) setTargets(out)
    })
    return () => {
      live = false
    }
  }, [mode, items, slots])

  /** How far each clipping travels to its site, measured inside its zoomed layer, and that layer's zoom undone (`lens`),
   * so the ember and its light come out the same size whatever the zoom was. */
  const falls = useMemo(
    () =>
      items.map((_, i) => {
        const z = zooms[i % 3].get()
        const to = fallOf(i, targets, slots, z)
        return to && { to, lens: 1 / z }
      }),
    [items, targets, slots, zooms],
  )
  /** Where each clipping rises from: the middle of the screen, behind the number, measured from its own place. */
  const rises = useMemo(
    () => slots.map((s) => ({ x: ((50 - s.x) / 100) * window.innerWidth, y: ((50 - s.y) / 100) * window.innerHeight })),
    [slots],
  )
  /** Behind the words, each clipping eases a little further from the middle, opening space around them. */
  const recedes = useMemo(
    () => slots.map((s) => ({ x: ((s.x - 50) / 100) * window.innerWidth * 0.12, y: ((s.y - 50) / 100) * window.innerHeight * 0.12 })),
    [slots],
  )

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {zooms.map((zoom, layer) => (
        <motion.div key={layer} className="absolute inset-0 will-change-transform" style={{ scale: zoom }}>
          {items.map(
            (it, i) =>
              i % 3 === layer &&
              i < landed && (
                <Clipping
                  key={it.h.text}
                  h={it.h}
                  slot={slots[i]}
                  depth={Math.min(landed - 1 - i, 6)}
                  mode={mode}
                  fall={mode === "fall" ? (falls[i]?.to ?? null) : null}
                  lens={falls[i]?.lens ?? 1}
                  rise={rises[i]}
                  recede={recedes[i]}
                  first={i === 0}
                  delay={i * 0.035}
                  photo={!!it.h.photo && decoded.has(it.h.photo.file)}
                  phone={phone}
                />
              ),
          )}
        </motion.div>
      ))}

      {/* a dark pool behind the words, so the pile stays a texture they're read over */}
      <motion.div
        className="absolute inset-0 bg-[radial-gradient(56%_42%_at_50%_50%,color-mix(in_oklab,var(--p-ink-950)_92%,transparent),transparent)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: mode === "float" ? 1 : 0 }}
        transition={{ duration: 1.2 }}
      />

      <AnimatePresence>
        {mode === "count" && (
          <motion.div
            key="count"
            className="absolute inset-0 grid place-items-center text-white"
            initial={{ opacity: 0, filter: "blur(10px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            // the number goes first, past the camera, as the rush begins
            exit={{ opacity: 0, scale: 1.8, transition: { duration: 0.55, ease: [0.5, 0, 0.9, 0.4] } }}
            transition={{ delay: count.enter, duration: 0.7, ease }}
          >
            {/* "days" is there from the first number, so it's clear what is being counted; it comes to full strength on today.
                The number keeps the width of its final value and grows away from the word, so the word never slides. */}
            <p className="flex items-baseline gap-4">
              <motion.span
                dir="ltr"
                className="inline-block text-left text-display tabular-nums"
                style={{ minWidth: `${days.toLocaleString("he-IL").length}ch` }}
              >
                {shown}
              </motion.span>{" "}
              <motion.span
                className="text-title-1"
                initial={{ opacity: 0.55 }}
                animate={{ opacity: today ? 1 : 0.55 }}
                transition={{ duration: 0.8, ease }}
              >
                ימים
              </motion.span>
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * One clipping: it rises from the depth to its place, sinks under the ones that land after it, recedes behind the words,
 * and falls to its site. Position (recede, fall) and drift each have a layer; the paper itself carries the rise, the sink,
 * the tilt and the shrink.
 */
const Clipping = memo(function Clipping({
  h,
  slot,
  depth,
  mode,
  fall,
  lens,
  rise,
  recede,
  first,
  delay,
  photo,
  phone,
}: {
  h: Headline
  slot: Slot
  depth: number
  mode: MontageMode
  fall: { x: number; y: number } | null
  /** undoes the layer's zoom, for what must keep its size on screen */
  lens: number
  rise: { x: number; y: number }
  recede: { x: number; y: number }
  first: boolean
  delay: number
  photo: boolean
  phone: boolean
}) {
  const counting = mode === "count"
  const float = mode === "float"
  // under the newer ones while counting; further back and darker once the words take over, and it stays dark as it falls
  const sink = counting ? depth * 0.022 : 0.1
  const dim = counting ? depth * 0.075 : 0.74
  // the first headline rises slower than the rest, so the eye learns where they come from
  const time = first ? 1.7 : 1.15
  return (
    <motion.div
      // the position moves only behind the words and in the fall, so only then does it get a layer of its own
      className={cn("absolute -translate-x-1/2 -translate-y-1/2", !counting && "will-change-transform")}
      style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
      animate={fall ?? (float ? recede : { x: 0, y: 0 })}
      transition={fall ? { delay, duration: 1.5, ease: [0.55, 0, 0.3, 1] } : { duration: 2.4, ease, delay: float ? delay * 2 : 0 }}
    >
      <div
        className={float ? "clip-float" : undefined}
        style={float ? ({ "--float": `${6 + Math.abs(slot.r)}s` } as React.CSSProperties) : undefined}
      >
        {/* One moving layer per clipping. The rise is its entrance: small and far away behind the number, it comes out
            toward the camera and turns to its tilt, slowing into its place without passing it. */}
        <motion.article
          className={cn(
            "relative grid grid-cols-[1fr_auto] items-center rounded-[3px] shadow-[0_28px_50px_-24px_rgb(0_0_0/0.9)] will-change-transform",
            phone ? "w-[196px] gap-2 p-2.5" : "w-[330px] gap-3 p-3.5",
            h.mourning ? "bg-clipping-mourning text-white ring-1 ring-white/25 ring-inset" : "bg-clipping text-clipping-ink",
          )}
          initial={{ opacity: 0, scale: 0.42, x: rise.x, y: rise.y, rotate: 0 }}
          animate={
            fall
              ? { scale: 0.065 * lens, rotate: 0, x: 0, y: 0, opacity: [1, 1, 0] }
              : { opacity: 1, scale: 1 - sink, rotate: slot.r, x: 0, y: 0 }
          }
          transition={
            fall
              ? { delay, duration: 1.45, ease: [0.55, 0, 0.3, 1], opacity: { delay, duration: 1.45, times: [0, 0.86, 1] } }
              : { duration: time, ease: RISE, delay: float ? delay * 2 : 0, opacity: { duration: time * 0.4 } }
          }
        >
          <div className="min-w-0">
            <p dir="ltr" className={cn("text-right text-micro font-bold tabular-nums", h.mourning ? "text-white/60" : "text-brand")}>
              {h.when ?? formatDate(h.date)}
            </p>
            <h3 className={cn("mt-0.5 font-black text-balance", phone ? "text-[13.5px] leading-[1.2]" : "text-title-3 leading-[1.15]")}>
              {h.text}
            </h3>
            {!phone && <p className={cn("mt-1 text-micro", h.mourning ? "text-white/45" : "text-clipping-ink/55")}>{h.source.label}</p>}
          </div>
          {h.photo && photo && (
            <img
              src={`/headlines/${h.photo.file}`}
              alt=""
              width={phone ? 64 : 96}
              height={phone ? 48 : 72}
              className={cn("rounded-[2px] object-cover", phone ? "h-12 w-16" : "h-[72px] w-24")}
            />
          )}
          {/* sinking under the newer ones: a dark layer that thickens, never a filter */}
          <motion.div
            className="pointer-events-none absolute inset-0 rounded-[3px] bg-[var(--p-ink-950)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: dim }}
            // behind the words it darkens with the rush itself, so the eye is left with the words
            transition={{ duration: float ? rush.seconds * 0.7 : 0.4, delay: float ? delay : 0 }}
          />
          {/* falling, the paper turns to an ember: the flower's red */}
          <motion.div
            className="pointer-events-none absolute inset-0 rounded-[3px] bg-[var(--p-anemone-500)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: fall ? 1 : 0 }}
            transition={{ delay: delay + 0.4, duration: 0.9 }}
          />
        </motion.article>
      </div>
      {/* where it lands, the ember lights up as a flower's light */}
      {fall && (
        <motion.span
          className="absolute top-1/2 left-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,var(--p-anemone-400),var(--p-anemone-600)_55%,transparent)] shadow-[0_0_24px_8px_color-mix(in_oklab,var(--p-anemone-500)_45%,transparent)]"
          initial={{ opacity: 0, scale: 0.3 * lens }}
          animate={{ opacity: [0, 1, 1, 0], scale: [0.3, 1.25, 1, 2.2].map((k) => k * lens) }}
          transition={{ delay: delay + 1.3, duration: 1.8, times: [0, 0.15, 0.5, 1] }}
        />
      )}
    </motion.div>
  )
})
