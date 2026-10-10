import { useEffect, useRef, useState, type ReactNode } from "react"
import { RETURN_LABEL } from "@/data/taxonomy"
import type { Revival } from "@/types"
import { cn } from "@/lib/utils"

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
