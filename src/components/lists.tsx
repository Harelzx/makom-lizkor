import { useMemo, useState } from "react"
import { Collapsible } from "radix-ui"
import { ChevronDownIcon } from "lucide-react"
import { motion } from "motion/react"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Anemone } from "@/components/anemone"
import { KindIcon } from "@/components/kind-icon"
import { RevivalStrip } from "@/components/revival-strip"
import { KINDS } from "@/data/taxonomy"
import { GroupLabel, Img, StatusText } from "@/components/kit"
import { stagger, ease, spring } from "@/lib/motion"
import { allPlaces, matches, sitesNear, useStore } from "@/store"
import type { Place } from "@/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useVisits, visitKey } from "@/lib/visit-list"

function Row({ place, i, children }: { place: Place; i: number; children: React.ReactNode }) {
  const select = useStore((s) => s.select)
  const hover = useStore((s) => s.hover)
  const hovered = useStore((s) => s.hoveredId === place.id)
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...stagger(i), duration: 0.22, ease }}>
      <button
        onClick={() => select(place.id)}
        onMouseEnter={() => hover(place.id)}
        onMouseLeave={() => hover(null)}
        onFocus={() => hover(place.id)}
        onBlur={() => hover(null)}
        className={cn(
          "pressable flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-start outline-none hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring",
          hovered && "bg-surface-2",
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
  const groups = [
    { id: "local", title: "הוספתם במכשיר הזה", items: places.filter((p) => p.local) },
    { id: "envelope", title: "בעוטף עזה", items: places.filter((p) => !p.local && p.region === "envelope") },
    { id: "country", title: "ברחבי הארץ", items: places.filter((p) => !p.local && p.region === "country") },
  ].filter((g) => g.items.length)
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
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <Collapsible.Root key={g.id} open={searching || active === g.id} onOpenChange={(open) => setOpened(open ? g.id : "")}>
          {searching ? (
            <GroupLabel id={`g-${g.id}`} count={g.items.length}>
              {g.title}
            </GroupLabel>
          ) : (
            <h3>
              <Collapsible.Trigger asChild>
                <button className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-3 text-start text-label text-ink-2 outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="min-w-0 flex-1">{g.title}</span>
                  <span className="text-caption tabular-nums">{g.items.length}</span>
                  <ChevronDownIcon
                    aria-hidden="true"
                    className={cn("size-4 shrink-0 transition-transform motion-reduce:transition-none", active === g.id && "rotate-180")}
                  />
                </button>
              </Collapsible.Trigger>
            </h3>
          )}
          <Collapsible.Content>
            <ul aria-label={g.title} className="mt-2 flex flex-col gap-1">
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
                    <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-3">
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
      <ul className="flex flex-col">
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
