import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { SearchIcon } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { PlaceDetail } from "@/components/place-detail"
import { CommunityDetail } from "@/components/community-detail"
import { CommunitiesList, PlacesList } from "@/components/lists"
import { Journey } from "@/components/journey"
import { allPlaces, useStore, type Tab } from "@/store"
import { flyToEnvelope } from "@/map/controller"
import { ease, spring } from "@/lib/motion"

const TABS: { id: Tab; label: string }[] = [
  { id: "places", label: "מקומות" },
  { id: "communities", label: "קהילות" },
  { id: "journey", label: "מסע 232" },
]

/** Everything the side panel (desktop) and the bottom sheet (phones) show. */
export function Explorer() {
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)
  const query = useStore((s) => s.query)
  const setQuery = useStore((s) => s.setQuery)
  const seed = useStore((s) => s.seed)
  const local = useStore((s) => s.local)
  const remote = useStore((s) => s.remote)
  const selected = selectedId ? allPlaces({ seed, remote, local }).find((p) => p.id === selectedId) : null
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
      if (e.key === "Escape" && !s.searchOpen && !s.addOpen && !s.aboutOpen) back()
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
          transition={{ duration: 0.32, ease }}
        >
          {/* A tab opens when chosen (Enter, Space, a click), not when the focus merely passes over it: VoiceOver moves
              the focus as it reads, and with tabs that open on focus a screen reader always landed on the last one. */}
          <Tabs
            activationMode="manual"
            value={tab}
            onValueChange={(v) => {
              setDir(order(v as Tab) >= order(tab) ? 1 : -1)
              setTab(v as Tab)
            }}
            className="gap-4"
          >
            <TabsList className="h-11 w-full bg-surface-2 p-1">
              {TABS.map((t) => (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  className="relative z-0 h-full text-label text-ink-2 data-active:bg-transparent data-active:text-ink-1 data-active:shadow-none dark:data-active:bg-transparent"
                >
                  {/* the indicator slides between tabs instead of blinking */}
                  {tab === t.id && (
                    <motion.span
                      layoutId="tab-pill"
                      className="absolute inset-0 -z-10 rounded-full bg-surface shadow-chip"
                      transition={spring.snappy}
                    />
                  )}
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {tab !== "journey" && (
              <InputGroup className="h-11 rounded-2xl border-transparent bg-surface-2 text-body">
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

            <TabsContent value="places">
              <motion.div initial={{ opacity: 0, x: dir * -24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.28, ease }}>
                <PlacesList />
              </motion.div>
            </TabsContent>
            <TabsContent value="communities">
              <motion.div initial={{ opacity: 0, x: dir * -24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.28, ease }}>
                <CommunitiesList />
              </motion.div>
            </TabsContent>
            <TabsContent value="journey">
              <motion.div initial={{ opacity: 0, x: dir * -24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.28, ease }}>
                <Journey />
              </motion.div>
            </TabsContent>
          </Tabs>
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
