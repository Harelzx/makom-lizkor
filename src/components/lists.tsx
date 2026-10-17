import { useMemo, useState } from "react"
import { Collapsible } from "radix-ui"
import { ChevronDownIcon } from "lucide-react"
import { motion } from "motion/react"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Anemone } from "@/components/anemone"
import { KindIcon } from "@/components/kind-icon"
import { RevivalStrip } from "@/components/revival-strip"
import { KINDS } from "@/data/taxonomy"
import { Img, StatusText } from "@/components/kit"
import { stagger, ease, spring } from "@/lib/motion"
import { allPlaces, matches, sitesNear, useStore } from "@/store"
import type { Place } from "@/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useVisits, visitKey } from "@/lib/visit-list"
import { groupPlaces } from "@/lib/regions"

/** A card raised off the sheet's material (or the panel), holding a group of rows. */
const CARD = "overflow-hidden rounded-2xl bg-raised shadow-chip ring-1 ring-line"

function Count({ n }: { n: number }) {
  return <span className="min-w-7 rounded-full bg-fill px-2 py-0.5 text-center text-caption text-ink-2 tabular-nums">{n}</span>
}

function Row({ place, i, children }: { place: Place; i: number; children: React.ReactNode }) {
  const select = useStore((s) => s.select)
  const hover = useStore((s) => s.hover)
  const hovered = useStore((s) => s.hoveredId === place.id)
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...stagger(i), duration: 0.22, ease }}
      // a hairline between rows, from where the text starts, as in the system's grouped lists
      className="relative not-first:before:absolute not-first:before:start-(--rule) not-first:before:end-0 not-first:before:top-0 not-first:before:h-px not-first:before:bg-line"
    >
      <button
        onClick={() => select(place.id)}
        onMouseEnter={() => hover(place.id)}
        onMouseLeave={() => hover(null)}
        onFocus={() => hover(place.id)}
        onBlur={() => hover(null)}
        // The highlight follows a pointer that hovers. On a touch screen a tap leaves the browser's hover on the row,
        // which read as a row picked out from the rest; a press shows instead, while the finger is down.
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3 text-start outline-none focus-visible:bg-fill focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-fill-2 [@media(hover:hover)]:hover:bg-fill",
          hovered && "[@media(hover:hover)]:bg-fill",
        )}
      >
        {children}
      </button>
    </motion.li>
  )
}

export function PlacesList() {
  const local = useStore((s) => s.local)
  const remote = useStore((s) => s.remote)
  const query = useStore((s) => s.query)
  const visits = useVisits()
  // One group at a time. A search reveals every matching group so results never hide in a closed section.
  const [opened, setOpened] = useState<string | null>(null)
  const places = useMemo(
    () =>
      allPlaces({ remote, local }).filter(
        (p) => p.kind !== "community" && matches(p, query) && (visits.filter === "all" || (!p.local && visits.ids.includes(visitKey(p)))),
      ),
    [remote, local, query, visits.filter, visits.ids],
  )
  const groups = useMemo(() => groupPlaces(places), [places])
  const active = opened === null ? groups[0]?.id : opened
  const searching = !!query.trim()

  if (!places.length)
    return (
      <Empty>
        <EmptyHeader>
          <motion.img
            src="/art/bud.webp"
            alt=""
            className="mx-auto mb-1 w-20"
            initial={{ y: 10, rotate: -12, opacity: 0 }}
            animate={{ y: 0, rotate: -4, opacity: 1 }}
            transition={spring.bouncy}
          />
          <EmptyTitle>{visits.filter === "saved" && !query ? "עוד אין כאן מקום שמור לביקור" : "לא מצאנו מקום בשם הזה"}</EmptyTitle>
          <EmptyDescription>
            {visits.filter === "saved" && !query
              ? "פתחו מקום שמעניין אתכם ובחרו בשמירה לביקור."
              : "נסו שם של יישוב, חלק משם המקום או שם האדם שהוא מנציח."}
          </EmptyDescription>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              className="h-11 rounded-full"
              onClick={() => {
                useStore.getState().setQuery("")
                visits.setFilter("all")
              }}
            >
              {query ? "ניקוי החיפוש" : "לכל המקומות"}
            </Button>
            <Button
              variant="ghost"
              className="min-h-11 rounded-full whitespace-normal"
              onClick={() => useStore.getState().setAddOpen(true)}
            >
              מכירים מקום שחסר? הוסיפו אותו
            </Button>
          </div>
        </EmptyHeader>
      </Empty>
    )

  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        // Each region is one card, open or closed: its heading and its places inside one edge.
        <Collapsible.Root
          key={g.id}
          open={searching || active === g.id}
          onOpenChange={(open) => setOpened(open ? g.id : "")}
          className={CARD}
        >
          {searching ? (
            <h3 id={`g-${g.id}`} className="flex min-h-12 items-center gap-3 px-4 py-3 text-headline text-ink-1">
              <span className="min-w-0 flex-1">{g.title}</span>
              <Count n={g.items.length} />
            </h3>
          ) : (
            <h3>
              <Collapsible.Trigger asChild>
                <button className="pressable flex min-h-12 w-full items-center gap-3 px-4 py-3 text-start text-headline text-ink-1 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-fill-2 [@media(hover:hover)]:hover:bg-fill">
                  <span className="min-w-0 flex-1">{g.title}</span>
                  <Count n={g.items.length} />
                  <ChevronDownIcon
                    aria-hidden="true"
                    className={cn(
                      "size-4 shrink-0 text-ink-2 transition-transform motion-reduce:transition-none",
                      active === g.id && "rotate-180",
                    )}
                  />
                </button>
              </Collapsible.Trigger>
            </h3>
          )}
          <Collapsible.Content>
            <ul aria-label={g.title} className="flex flex-col border-t border-line [--rule:76px]">
              {g.items.map((p, i) => (
                <Row key={p.id} place={p} i={i}>
                  {p.local?.photo || p.contributedPhoto ? (
                    <img src={p.local?.photo ?? p.contributedPhoto!.url} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
                  ) : p.photos?.[0] ? (
                    <motion.span
                      layoutId={`ph-${p.id}`}
                      transition={spring.soft}
                      style={{ borderRadius: 12 }}
                      className="size-12 shrink-0 overflow-hidden"
                    >
                      <Img src={p.photos[0].thumb_url} alt="" className="size-full object-cover" />
                    </motion.span>
                  ) : (
                    <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-fill text-ink-2">
                      {p.local ? <Anemone size={26} variant="pale" /> : <KindIcon kind={p.kind} className="size-5" />}
                    </span>
                  )}
                  <span className="flex min-w-0 flex-col">
                    <span className="line-clamp-2 text-body font-semibold text-ink-1">{p.name_he}</span>
                    <span className="line-clamp-2 text-caption text-ink-2">
                      {KINDS[p.kind].label} · {p.place_he}
                    </span>
                  </span>
                </Row>
              ))}
            </ul>
          </Collapsible.Content>
        </Collapsible.Root>
      ))}
    </div>
  )
}

export function CommunitiesList() {
  const local = useStore((s) => s.local)
  const remote = useStore((s) => s.remote)
  const query = useStore((s) => s.query)
  const all = useMemo(() => allPlaces({ remote, local }), [remote, local])
  const communities = all.filter((p) => p.kind === "community" && matches(p, query)).sort((a, b) => b.lat - a.lat)

  return (
    <div className="flex flex-col gap-3">
      <RevivalStrip />
      <p className="px-3 pt-1 text-body text-pretty text-ink-2">לכל קהילה שני סיפורים: מי שהיא איבדה, ואיך היא חוזרת.</p>
      <ul className={cn(CARD, "flex flex-col [--rule:16px]")}>
        {communities.map((c, i) => {
          const n = sitesNear(c, all).length
          return (
            <Row key={c.id} place={c} i={i}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-headline font-bold text-ink-1">{c.name_he}</span>
                <span className="text-caption text-ink-2">{n ? `${n} אתרי זיכרון` : "קהילה שהותקפה"}</span>
              </span>
              {c.revival && c.revival.status !== "unknown" && <StatusText status={c.revival.status} className="max-w-[45%] shrink-0" />}
            </Row>
          )
        })}
      </ul>
    </div>
  )
}
