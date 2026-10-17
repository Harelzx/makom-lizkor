import { useEffect, useRef, useState, type ReactNode, type Ref } from "react"
import { ChevronDownIcon } from "lucide-react"
import { RETURN_LABEL } from "@/data/taxonomy"
import type { Revival } from "@/types"
import { cn } from "@/lib/utils"

/** A card raised off the sheet's material (or the panel), holding a group of rows. */
export const CARD = "overflow-hidden rounded-2xl bg-raised shadow-chip ring-1 ring-line"
/** A row in a card: a hairline above it, from where the text starts (`--rule` on the list), as in the system's grouped lists. */
export const RULED =
  "relative not-first:before:absolute not-first:before:start-(--rule) not-first:before:end-0 not-first:before:top-0 not-first:before:h-px not-first:before:bg-line"
/**
 * A row's press. The highlight follows a pointer that hovers: on a touch screen a tap leaves the browser's hover on the
 * row, which read as a row picked out from the rest, so there it shows only while the finger is down.
 */
export const PRESS =
  "outline-none focus-visible:bg-fill focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-fill-2 [@media(hover:hover)]:hover:bg-fill"

/** An image that waits on a quiet tile and fades in once decoded, so nothing pops. */
export function Img({ className, onLoad, placeholder, style, ...props }: React.ComponentProps<"img"> & { placeholder?: string }) {
  const [loaded, setLoaded] = useState(false)
  // With a placeholder (a small cached thumbnail) the frame is never empty: the sharp image settles over it.
  if (placeholder)
    return (
      <span
        className={cn("relative block overflow-hidden bg-surface-3 bg-cover bg-center", className)}
        style={{ ...style, backgroundImage: `url(${placeholder})` }}
      >
        <img
          decoding="async"
          loading="lazy"
          {...props}
          onLoad={(e) => {
            setLoaded(true)
            onLoad?.(e)
          }}
          className={cn("size-full object-cover transition-opacity duration-500", loaded ? "opacity-100" : "opacity-0")}
        />
      </span>
    )
  return (
    <img
      style={style}
      decoding="async"
      loading="lazy"
      {...props}
      onLoad={(e) => {
        setLoaded(true)
        onLoad?.(e)
      }}
      className={cn(
        "bg-surface-3 transition-[opacity,filter] duration-500 ease-out",
        loaded ? "blur-0 opacity-100" : "opacity-0 blur-sm",
        className,
      )}
    />
  )
}

/**
 * The return mark: one dot, drawn the way the map and the strip draw it.
 * Full when the community is home, half while it returns, a broken ring while it's still on the way.
 */
export function StatusDot({ status, size = 10 }: { status: Revival["status"]; size?: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} className="shrink-0 text-hope" aria-hidden="true">
      {status === "full" && <circle cx="6" cy="6" r="5" fill="currentColor" />}
      {status === "partial" && (
        <>
          <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M6 1.4 A4.6 4.6 0 0 1 6 10.6 Z" fill="currentColor" />
        </>
      )}
      {(status === "not-yet" || status === "unknown") && (
        <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.2 1.8" />
      )}
    </svg>
  )
}

/** Status as a line of text with its dot: no pill, no fill. */
export function StatusText({ status, date, className }: { status: Revival["status"]; date?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-caption text-ink-2", className)}>
      <StatusDot status={status} />
      {RETURN_LABEL[status]}
      {date && <span className="text-ink-3">· {date}</span>}
    </span>
  )
}

/** Section heading inside a panel: an icon in its color, a title on the scale. */
export function SectionTitle({
  icon,
  children,
  id,
  tone = "ink",
}: {
  icon?: ReactNode
  children: ReactNode
  id?: string
  tone?: "ink" | "hope" | "brand"
}) {
  return (
    <h3 id={id} className="flex items-center gap-2 text-title-3 text-ink-1">
      {icon && (
        <span className={cn("grid place-items-center", tone === "hope" && "text-hope", tone === "brand" && "text-brand")}>{icon}</span>
      )}
      {children}
    </h3>
  )
}

/** Small group label above a list: plain sentence case, quiet, with an optional count. */
export function GroupLabel({ children, count, id }: { children: ReactNode; count?: number; id?: string }) {
  return (
    <h3 id={id} className="flex items-baseline justify-between gap-3 border-b border-line px-3 pb-2 text-label font-semibold text-ink-2">
      {children}
      {count !== undefined && <span className="tabular-nums">{count}</span>}
    </h3>
  )
}

/**
 * Before visiting near the Gaza border. Facts only: a place being listed says nothing about whether it is open, allowed
 * or safe to reach, and the Home Front Command's instructions are the ones that count. One quiet line, like the rest of
 * the site's metadata, not an alarm.
 */
export function SafetyNote({ lead, className }: { lead: string; className?: string }) {
  return (
    <p className={cn("reading-copy text-body text-ink-2", className)}>
      {lead} הופעה כאן אינה אומרת שהמקום פתוח לביקור או שמותר להגיע אליו. לפני יציאה בדקו את{" "}
      <a className="text-ink-1 underline underline-offset-2" href="https://www.oref.org.il" target="_blank" rel="noopener">
        ההנחיות של פיקוד העורף
      </a>
      , וביישובים תאמו ביקור מראש.
    </p>
  )
}

/**
 * A card that opens takes the focus at its title. The control that opened it (a row in the list, a search result, a
 * flower) is often gone the moment the card appears, and with it the focus; VoiceOver then lost its place and never
 * heard the card. No scrolling and no ring: the title isn't a control, it's where reading starts.
 */
export function useFocusOnOpen<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])
  return ref
}

/**
 * A box that opens in place. Closed, it is one row, as tall as its line needs: a box padded around a row that was
 * itself padded stood twice the height of its one line. The whole row is the target, and a chevron, not the browser's
 * triangle, says whether it is open.
 */
export function Disclosure({
  summary,
  children,
  className,
  bodyClassName,
  summaryClassName,
  ref,
}: {
  summary: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  summaryClassName?: string
  ref?: Ref<HTMLDetailsElement>
}) {
  return (
    <details ref={ref} className={cn("group/disclosure rounded-2xl border border-line", className)}>
      <summary
        className={cn(
          "pressable flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 text-label text-ink-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/30 [&::-webkit-details-marker]:hidden",
          summaryClassName,
        )}
      >
        {summary}
        <ChevronDownIcon
          aria-hidden="true"
          className="ms-auto size-4 shrink-0 text-ink-2 transition-transform group-open/disclosure:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className={cn("px-4 pb-4 text-body text-ink-2", bodyClassName)}>{children}</div>
    </details>
  )
}

/**
 * A choice between a few views or kinds: one track, a thumb on the chosen one. Two pills side by side, one filled and one
 * bare or outlined, read as a button and a label. Each option stays a button with aria-pressed.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: readonly (readonly [T, ReactNode])[]
  onChange: (value: T) => void
  label?: string
}) {
  return (
    <div className="flex gap-1 rounded-full bg-fill p-1" role="group" aria-label={label}>
      {options.map(([id, content]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={cn(
            "pressable flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1 text-label leading-tight whitespace-normal text-ink-2 transition-colors outline-none hover:text-ink-1 focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-50 motion-reduce:transition-none",
            "aria-pressed:bg-thumb aria-pressed:font-semibold aria-pressed:text-ink-1 aria-pressed:shadow-chip",
          )}
        >
          {content}
        </button>
      ))}
    </div>
  )
}
