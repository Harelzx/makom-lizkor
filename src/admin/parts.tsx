import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ease } from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { Kind } from "@/types"
import { KINDS } from "@/data/taxonomy"
import { GLYPH, type GlyphName } from "./glyphs"
import allDone from "./assets/all-done.webp"
import offline from "./assets/offline.webp"
import contours from "./assets/contours.webp"
import type { Said } from "./inbox-state"

const ART = import.meta.glob<string>("./assets/kinds/*.svg", { eager: true, query: "?url", import: "default" })
const artOf = (kind: Kind) => ART[`../assets/kinds/${kind}.svg`]

/** One of the page's hand-drawn marks. Decorative unless labelled: the button or text beside it carries the meaning. */
export function Glyph({ name, className, label, flip }: { name: GlyphName; className?: string; label?: string; flip?: boolean }) {
  const [transform, d] = GLYPH[name]
  return (
    <svg
      viewBox="0 0 512 512"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      className={cn("size-[1.15em] shrink-0", flip && "-scale-x-100", className)}
    >
      <g transform={transform} fill="currentColor">
        <path d={d} />
      </g>
    </svg>
  )
}

export const kindGlyph = (kind: Kind): GlyphName => `kind_${kind}` as GlyphName

/** The kind's full drawing, for the item's header: the same hand as the marks, at a size it can be read at. */
export function KindArt({ kind, className }: { kind: Kind; className?: string }) {
  return <span aria-hidden className={cn("a-art inline-block", className)} style={{ "--art": `url("${artOf(kind)}")` } as CSSProperties} />
}
export const kindLabel = (kind: Kind) => KINDS[kind].label

type Tone = "red" | "green" | "sun" | "ink"
const TONE: Record<Tone, string> = {
  red: "bg-(--a-red-soft) text-(--a-red-ink)",
  green: "bg-(--a-green-soft) text-(--a-green-ink)",
  sun: "bg-(--a-sun-soft) text-(--a-sun)",
  ink: "bg-(--a-sunk) text-(--a-ink-2)",
}
/** A short state that has to be seen at a glance (hidden, late, private), always in words, never color alone. */
export function Chip({
  tone = "ink",
  glyph,
  children,
  className,
}: {
  tone?: Tone
  glyph?: GlyphName
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] font-semibold whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {glyph && <Glyph name={glyph} className="size-3.5" />}
      {children}
    </span>
  )
}

/** A key's hint: for the eye only (the control's name stays the action), and only where there's a keyboard. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      aria-hidden
      className={cn(
        "hidden h-5 min-w-5 place-items-center rounded-md border border-current px-1 font-sans text-[0.6875rem] leading-none font-semibold opacity-60 pointer-fine:inline-grid",
        className,
      )}
    >
      {children}
    </kbd>
  )
}

/** The point that would be published, on the hills' own contour lines, with the exact numbers and a way to check it. */
export function MapThumb({ lat, lng, approximate, className }: { lat: number; lng: number; approximate: boolean; className?: string }) {
  // Each place gets its own patch of the land, so two neighbours never look like the same picture.
  const offset = `${Math.round((lng * 7919) % 560)}px ${Math.round((lat * 104729) % 560)}px`
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-(--a-line) bg-(--a-panel)", className)}>
      <div className="relative h-36 overflow-hidden bg-(--a-panel-2)">
        <span
          aria-hidden
          className="absolute inset-0 opacity-25 dark:opacity-20 dark:invert"
          style={{ backgroundImage: `url(${contours})`, backgroundSize: "560px", backgroundPosition: offset }}
        />
        {approximate && (
          <span
            aria-hidden
            className="absolute start-1/2 top-1/2 size-28 translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-(--a-red)/50 bg-(--a-red)/5"
          />
        )}
        <Glyph name="pin" className="absolute start-1/2 top-1/2 size-9 translate-x-1/2 -translate-y-full text-(--a-red) drop-shadow-sm" />
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-[0.875rem]">
        <span dir="ltr" className="font-medium text-(--a-ink-1) tabular-nums [unicode-bidi:isolate]">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </span>
        <a
          className="a-focus-ring inline-flex min-h-8 items-center gap-1.5 rounded-md font-semibold text-(--a-ink-1) underline decoration-(--a-line-2) decoration-2 underline-offset-4 hover:decoration-current"
          href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          פתיחה במפה
          <Glyph name="external" className="size-3.5" />
        </a>
      </div>
      <p className="border-t border-(--a-line) px-4 py-2.5 text-[0.8125rem] text-(--a-ink-2)">
        {approximate ? "מיקום משוער: יוצג באתר כאזור, לא כנקודה" : "מיקום מדויק: יוצג באתר כנקודה"}
      </p>
    </div>
  )
}

/** The whole page's empty and failed states, drawn rather than said in grey: done for the day, or no line to the server. */
export function Scene({
  kind,
  title,
  children,
  className,
}: {
  kind: "done" | "offline"
  title: string
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      <img
        src={kind === "done" ? allDone : offline}
        alt=""
        width={320}
        height={214}
        className="h-auto w-72 max-w-full select-none dark:drop-shadow-[0_0_40px_rgb(255_240_220/0.08)]"
        draggable={false}
      />
      <h2 className="mt-4 text-[1.375rem] font-bold text-(--a-ink-1)">{title}</h2>
      {children && <div className="mt-2 max-w-sm text-[0.9375rem] leading-relaxed text-(--a-ink-2)">{children}</div>}
    </div>
  )
}

/** What a decision did, said once: polite, so it never interrupts; a failure stays longer and reads as one. */
export function Toast({ said, className }: { said: Said | null; className?: string }) {
  return (
    <div aria-live="polite" className={cn("pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4", className)}>
      <AnimatePresence>
        {said && (
          <motion.p
            key={said.n}
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.26, ease } }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.16 } }}
            className={cn(
              "flex items-center gap-2.5 rounded-2xl px-4 py-3 text-[0.9375rem] font-medium shadow-(--a-shadow-lg)",
              said.tone === "error" ? "bg-(--a-red) text-(--a-on-solid)" : "bg-(--a-ink-1) text-(--a-panel)",
            )}
          >
            <Glyph
              name={said.tone === "error" ? "reject" : "approve"}
              className={cn("size-4", said.tone === "done" && "text-(--a-green)")}
            />
            {said.text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

/** A failure said in full at body size: the color and the mark carry the weight, not a smaller font. */
export function Alert({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      className={cn("flex items-start gap-2.5 rounded-xl bg-(--a-red-soft) px-3.5 py-3 text-[0.9375rem] text-(--a-red-ink)", className)}
    >
      <Glyph name="reject" className="mt-1 size-3.5" />
      <span>{children}</span>
    </p>
  )
}

/** Short metadata in one line with dot separators. */
export const meta = (parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" · ")

/** The date as the page's eyebrow, in Israel's calendar whatever the browser's zone. */
export const today = () =>
  new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem" })

/** Re-render once a minute, so "לפני 3 דקות" keeps telling the truth on a page left open. */
export function useMinute() {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])
}
