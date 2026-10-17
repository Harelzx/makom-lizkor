import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { BookmarkIcon, ChevronDownIcon, SearchIcon } from "lucide-react"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { PlaceDetail } from "@/components/place-detail"
import { CommunityDetail } from "@/components/community-detail"
import { CommunitiesList, PlacesList } from "@/components/lists"
import { Journey } from "@/components/journey"
import { allPlaces, useStore, type Tab } from "@/store"
import { flyToEnvelope } from "@/map/controller"
import { ease } from "@/lib/motion"
import { Button } from "@/components/ui/button"
import { useVisits } from "@/lib/visit-list"
import { Segmented } from "@/components/kit"

const TABS: { id: Tab; label: string }[] = [
  { id: "places", label: "מקומות" },
  { id: "communities", label: "קהילות" },
  { id: "journey", label: "מסע 232" },
]

/** Everything the side panel (desktop) and the bottom sheet (phones) show. */
export function Explorer() {
  const visits = useVisits()
  const initVisits = visits.init
  useEffect(() => {
    void initVisits()
  }, [initVisits])
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)
  const query = useStore((s) => s.query)
  const setQuery = useStore((s) => s.setQuery)
  const local = useStore((s) => s.local)
  const remote = useStore((s) => s.remote)
  const selected = selectedId ? allPlaces({ remote, local }).find((p) => p.id === selectedId) : null
  const showDetail = selected && tab !== "journey"
  // which way the new tab's content arrives: from the side of the tab that was chosen
  const [dir, setDir] = useState(1)
  const order = (t: Tab) => TABS.findIndex((x) => x.id === t)

  const back = () => {
    select(null)
    flyToEnvelope(2200)
  }

  // Esc steps back from a place to the list, unless a dialog is open and wants Esc for itself.
  useEffect(() => {
    if (!showDetail) return
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !(e.target as HTMLElement)?.closest('[role="dialog"], [role="alertdialog"]') &&
        !s.searchOpen &&
        !s.addOpen &&
        !s.aboutOpen
      )
        back()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {showDetail ? (
        selected.kind === "community" ? (
          <CommunityDetail key={selected.id} place={selected} onBack={back} />
        ) : (
          <PlaceDetail key={selected.id} place={selected} onBack={back} />
        )
      ) : (
        <motion.div
          key="tabs"
          initial={{ opacity: 0, x: 32 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 32, transition: { duration: 0.18 } }}
          transition={{ duration: 0.22, ease }}
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-title-3 font-bold text-ink-1">
                {tab === "places" ? "מקומות לזכור" : TABS.find((t) => t.id === tab)?.label}
              </h2>
              <details className="relative">
                <summary className="pressable flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-full bg-fill ps-4 pe-3 text-label text-ink-1 hover:bg-fill-2">
                  עוד על האזור <ChevronDownIcon className="size-4 text-ink-2" />
                </summary>
                <div className="absolute end-0 top-full z-10 mt-1 flex w-44 flex-col items-stretch gap-1 rounded-2xl bg-raised p-2 shadow-panel ring-1 ring-line">
                  {TABS.map((t) => (
                    <Button
                      key={t.id}
                      variant="ghost"
                      aria-pressed={tab === t.id}
                      onClick={(e) => {
                        setDir(order(t.id) >= order(tab) ? 1 : -1)
                        setTab(t.id)
                        const menu = e.currentTarget.closest("details")
                        if (menu) menu.open = false
                      }}
                      className="min-h-11 justify-start rounded-xl text-label"
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
              </details>
            </div>
            {tab === "places" ? (
              <Segmented
                label="תצוגת המקומות"
                value={visits.filter}
                onChange={visits.setFilter}
                options={[
                  ["all", "כל המפה"],
                  [
                    "saved",
                    <>
                      <BookmarkIcon className="size-4 shrink-0" aria-hidden="true" />
                      שמורים לביקור
                    </>,
                  ],
                ]}
              />
            ) : (
              <Button variant="ghost" className="h-11 justify-start rounded-full" onClick={() => setTab("places")}>
                חזרה למקומות
              </Button>
            )}
            {tab === "places" && visits.filter === "saved" && (
              <p className="px-2 text-body text-ink-2">רשימה פרטית במכשיר הזה בלבד. נשמרים קישורים למקומות שעדיין מוצגים במפה.</p>
            )}

            {tab !== "journey" && (
              <InputGroup className="h-11 rounded-full border-transparent bg-fill text-body">
                <InputGroupInput
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tab === "places" ? "חיפוש מקום, יישוב או שם" : "חיפוש קהילה"}
                  aria-label="חיפוש"
                  type="search"
                />
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
              </InputGroup>
            )}

            {tab === "places" && (
              <div>
                <motion.div initial={{ opacity: 0, x: dir * -24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22, ease }}>
                  <PlacesList />
                </motion.div>
              </div>
            )}
            {tab === "communities" && (
              <div>
                <motion.div initial={{ opacity: 0, x: dir * -24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22, ease }}>
                  <CommunitiesList />
                </motion.div>
              </div>
            )}
            {tab === "journey" && (
              <div>
                <motion.div initial={{ opacity: 0, x: dir * -24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22, ease }}>
                  <Journey />
                </motion.div>
              </div>
            )}
          </div>
          <SiteLinks />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** A second way to the accessibility statement, the privacy notice and the terms, besides About: the Commission asks for two. */
const SITE_LINKS = [
  ["accessibility", "הצהרת נגישות"],
  ["privacy", "פרטיות"],
  ["terms", "תנאי שימוש"],
] as const

function SiteLinks() {
  const openAbout = useStore((s) => s.openAbout)
  return (
    <nav aria-label="מידע על האתר" className="mt-6 flex flex-wrap justify-center gap-x-1 border-t border-line pt-3 pb-1">
      {SITE_LINKS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => openAbout(id)}
          className="pressable rounded-full px-2.5 py-1.5 text-caption text-ink-2 underline-offset-2 outline-none hover:text-ink-1 hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {label}
        </button>
      ))}
    </nav>
  )
}
