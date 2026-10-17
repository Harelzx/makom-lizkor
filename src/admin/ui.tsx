import type { ReactNode } from "react"
import { CircleAlert } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * The admin page's own pieces, on the site's tokens. A card is a white surface lifted off the canvas; inside it,
 * sections are split by a thin line, never by a tinted box, as everywhere else on the site.
 */
export const card = "rounded-3xl border border-line bg-surface p-5 shadow-chip sm:p-6"
/** A block inside a card: a line above it and the same rhythm every time. */
export const block = "mt-5 border-t border-line pt-5"
/** Native checkboxes keep their own semantics; they only take the brand's color and a size a finger can hit. */
export const check = "size-[1.125rem] shrink-0 accent-brand"
/** The site's input look for a native select, which shadcn doesn't style. */
export const select =
  "h-11 w-full rounded-3xl border border-transparent bg-input/50 px-3 text-body text-ink-1 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"

/** When something arrived, as a person says it, counted in Israel's calendar days whatever the browser's zone. */
export function ago(iso: string) {
  const zone = { timeZone: "Asia/Jerusalem" }
  const day = (d: Date) => Date.parse(d.toLocaleDateString("en-CA", zone))
  const at = new Date(iso)
  const days = Math.round((day(new Date()) - day(at)) / 86_400_000)
  const time = at.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", ...zone })
  return days <= 0 ? `היום, ${time}` : days === 1 ? `אתמול, ${time}` : days === 2 ? "לפני יומיים" : `לפני ${days} ימים`
}

/** The detail column: one item set for reading, its decisions in a bar that stays at the bottom while it scrolls. */
export const detailBody = "mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-10 sm:px-8 lg:px-12 lg:pt-11"
export const detailLabel = "mt-8 mb-2.5 text-label font-semibold text-ink-2"
export const detailBar = "sticky bottom-0 z-10 border-t border-line bg-glass pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
export const detailBarInner = "mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2.5 px-4 sm:px-8 lg:px-12"

/** A part of the page: its title, what it is for, and how many things wait in it. */
export function Section({
  id,
  title,
  lead,
  count,
  children,
  busy,
}: {
  id: string
  title: ReactNode
  lead?: ReactNode
  count?: string | null
  children: ReactNode
  busy?: boolean
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} aria-busy={busy || undefined} className="scroll-mt-24">
      <header className="border-b border-line pb-4">
        <div className="flex items-baseline gap-3">
          <h2 id={`${id}-title`} className="text-title-2 text-ink-1">
            {title}
          </h2>
          {/* The number beside the title, quiet: the header's figures are where it is read. */}
          {count != null && (
            <span aria-hidden className="text-title-3 text-ink-3 tabular-nums">
              {count}
            </span>
          )}
        </div>
        {lead && <p className="reading-copy mt-1 text-body text-ink-2">{lead}</p>}
      </header>
      <div className="mt-6">{children}</div>
    </section>
  )
}

/** A failure, said in full at body size: the color and the mark carry the weight, not a smaller font. */
export function Alert({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      className={cn(
        "flex items-start gap-2.5 border-s-2 border-destructive ps-3 text-body text-destructive dark:border-brand dark:text-brand",
        className,
      )}
    >
      <CircleAlert aria-hidden className="mt-1 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/** Short metadata in one caption line with dot separators, as on the site's cards. */
export const meta = (parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" · ")
