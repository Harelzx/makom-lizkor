import type { ReactNode } from "react"
import { CircleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

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

/** While a list loads: the shape of what is coming, so the page doesn't jump when it arrives. */
export function Loading({ rows = 2 }: { rows?: number }) {
  return (
    <div aria-hidden className="grid gap-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={card}>
          <Skeleton className="h-3.5 w-40 rounded-full bg-surface-3" />
          <Skeleton className="mt-3 h-6 w-64 max-w-full rounded-full bg-surface-3" />
          <Skeleton className="mt-4 h-3.5 w-full rounded-full bg-surface-3" />
          <Skeleton className="mt-2 h-3.5 w-4/5 rounded-full bg-surface-3" />
          <div className="mt-6 flex gap-2 border-t border-line pt-5">
            <Skeleton className="h-11 w-24 rounded-full bg-surface-3" />
            <Skeleton className="h-11 w-28 rounded-full bg-surface-3" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Nothing waiting: a calm answer rather than a blank space. */
export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-line-strong px-6 py-12 text-center">
      <span aria-hidden className="grid size-12 place-items-center rounded-full border border-line bg-surface text-ink-2 shadow-chip">
        {icon}
      </span>
      <p className="text-headline text-ink-1">{title}</p>
      {children && <p className="reading-copy text-body text-ink-2">{children}</p>}
    </div>
  )
}

/** Short metadata in one caption line with dot separators, as on the site's cards. */
export const meta = (parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" · ")
