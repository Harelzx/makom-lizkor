import { motion } from "motion/react"
import { ArrowRightIcon, ExternalLinkIcon, SproutIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Anemone } from "@/components/anemone"
import { PhotoGallery } from "@/components/photo-figure"
import { KINDS, formatMonth } from "@/data/taxonomy"
import { SectionTitle, StatusText } from "@/components/kit"
import { ease, spring } from "@/lib/motion"
import { allPlaces, sitesNear, useStore } from "@/store"
import type { Place } from "@/types"

/** A community holds both stories: who it lost, and how it is coming back. */
// `ref` lets AnimatePresence (popLayout) lift the leaving card out of the flow, so the list can take its place at once.
export function CommunityDetail({ place, onBack, ref }: { place: Place; onBack: () => void; ref?: React.Ref<HTMLElement> }) {
  const seed = useStore((s) => s.seed)
  const local = useStore((s) => s.local)
  const remote = useStore((s) => s.remote)
  const select = useStore((s) => s.select)
  const r = place.revival
  const sites = sitesNear(place, allPlaces({ seed, remote, local }))
  const photos = place.photos ?? []

  return (
    <motion.article
      ref={ref}
      initial={{ opacity: 0, x: -32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -32, transition: { duration: 0.2 } }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      // the card's parts settle in one short sequence; the photo is already flying in from the list
      className="cascade flex flex-col gap-6"
    >
      <Button variant="ghost" size="sm" onClick={onBack} className="-ms-2 -mb-2 self-start text-label text-ink-2">
        <ArrowRightIcon data-icon="inline-start" />
        כל הקהילות
      </Button>

      {photos.length > 0 && (
        <motion.div
          layoutId={`ph-${place.id}`}
          transition={spring.soft}
          data-no-cascade
          // The radius lives in style so Motion keeps the corners round mid-flight; the extra bottom room keeps the caption clear of the clipped corner.
          style={{ borderRadius: 24 }}
          className="-mx-1 -mb-6 overflow-hidden pb-6"
        >
          <PhotoGallery photos={photos} ratio="aspect-[16/10]" />
        </motion.div>
      )}

      <header className="flex flex-col gap-2">
        <h2 className="text-title-1 text-ink-1">{place.name_he}</h2>
        <p className="text-label font-normal text-ink-2">{place.place_he}</p>
        {r && r.status !== "unknown" && <StatusText status={r.status} date={r.date ? formatMonth(r.date) : undefined} className="mt-1" />}
      </header>

      <p className="text-body-lg text-pretty text-ink-1">{place.summary_he}</p>

      <section className="flex flex-col gap-4 border-t border-line pt-6" aria-labelledby="revival-h">
        <SectionTitle id="revival-h" icon={<SproutIcon className="size-5" />} tone="hope">
          תקומה
        </SectionTitle>
        {r ? (
          <>
            <p className="text-body-lg text-pretty text-ink-1">{r.revival_he}</p>
            {r.milestones_he.length > 0 && (
              // A small timeline: the date carries the line, the event follows.
              <ol className="relative flex flex-col gap-4 ps-5 before:absolute before:inset-y-1.5 before:start-[5px] before:w-px before:bg-hope/35">
                {r.milestones_he.map((m, i) => {
                  const cut = m.indexOf(":")
                  const when = cut > 0 && cut < 28 ? m.slice(0, cut) : null
                  const what = when ? m.slice(cut + 1).trim() : m
                  return (
                    <motion.li
                      key={m}
                      className="relative flex flex-col gap-0.5"
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.2 + i * 0.08, duration: 0.4, ease }}
                    >
                      <span
                        className="absolute -start-5 top-1.5 size-[11px] rounded-full border-2 border-hope bg-surface"
                        aria-hidden="true"
                      />
                      {when && <span className="text-caption font-bold text-hope-ink">{when}</span>}
                      <span className="text-body text-ink-1">{what}</span>
                    </motion.li>
                  )
                })}
              </ol>
            )}
            {r.sources.length > 0 && (
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-caption text-ink-2">
                מקורות:
                {r.sources.map((s) => (
                  <a
                    key={s.url}
                    href={s.url}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1 underline underline-offset-2"
                  >
                    {s.label_he}
                    <ExternalLinkIcon className="size-3" />
                  </a>
                ))}
              </p>
            )}
          </>
        ) : (
          <p className="text-body text-ink-2">עוד אין לנו מידע מאומת על החזרה לקהילה. אם אתם מכירים אותו, נשמח לשמוע.</p>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-line pt-6" aria-labelledby="memory-h">
        <h3 id="memory-h" className="flex items-center gap-2 text-title-3 text-ink-1">
          <Anemone size={22} />
          זיכרון
        </h3>
        {sites.length ? (
          <ul className="flex flex-col">
            {sites.map((s) => (
              <li key={s.id}>
                <button
                  className="pressable flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-start hover:bg-surface-2"
                  onClick={() => select(s.id)}
                >
                  <span className="text-body font-medium text-ink-1">{s.name_he}</span>
                  <span className="shrink-0 text-caption text-ink-3">{KINDS[s.kind].label}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-ink-2">עוד לא מיפינו כאן אתרי הנצחה. המשפחות והקהילה יודעות עליהם יותר מכולם.</p>
        )}
      </section>

      <p className="text-caption text-ink-3">{place.precision === "approx" ? "נקודה במרכז היישוב" : "מיקום מדויק"}</p>
    </motion.article>
  )
}
