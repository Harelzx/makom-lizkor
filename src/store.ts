import { create } from "zustand"
import seed from "@/data/places.json"
import type { Place } from "@/types"
import { loadLocal, loadTributes, saveLocal, saveTributes } from "@/lib/storage"

/** intro: 06:29, the dark map and the opening words · dawn: the sunrise is playing · day: the site itself */
export type Phase = "intro" | "dawn" | "day"
export type Tab = "places" | "communities" | "journey"
export type Light = "morning" | "night"

/** Set once the opening has been seen through; later visits go straight to the name. */
export const INTRO_SEEN = "makom-lizkor:v2-seen"
/** A shared link to a place lands on that place: the opening is for those who come in through the front door. */
const linkedToPlace = () => typeof location !== "undefined" && /^#\/place\/[^/]+/.test(location.hash)
/** The place a shared link names, chosen before the first render so the address is never rewritten under it. */
const linkedPlaceId = () => {
  if (!linkedToPlace()) return null
  const id = decodeURIComponent(location.hash.split("/")[2])
  return id.startsWith("local-") || (seed as Place[]).some((p) => p.id === id) ? id : null
}

interface State {
  phase: Phase
  light: Light
  seed: Place[]
  local: Place[]
  tributes: Record<string, number>
  selectedId: string | null
  hoveredId: string | null
  tab: Tab
  query: string
  addOpen: boolean
  aboutOpen: boolean
  /** About can open straight at one of its sections: the statement, the privacy notice, the terms. */
  aboutSection: string | null
  searchOpen: boolean
  picking: boolean
  draft: { lat: number; lng: number } | null
  journeyIndex: number
  journeyPlaying: boolean
  /** bumps when a visitor saves a place; the celebration listens */
  celebration: number
  /** bumps when the opening is played again, so it starts over from the date */
  introRun: number

  init: () => Promise<void>
  setPhase: (p: Phase) => void
  setLight: (l: Light) => void
  select: (id: string | null) => void
  hover: (id: string | null) => void
  setTab: (t: Tab) => void
  setQuery: (q: string) => void
  setAddOpen: (v: boolean) => void
  setAboutOpen: (v: boolean) => void
  openAbout: (section: string) => void
  setSearchOpen: (v: boolean) => void
  setPicking: (v: boolean) => void
  setDraft: (p: { lat: number; lng: number } | null) => void
  addLocal: (p: Place) => Promise<void>
  removeLocal: (id: string) => Promise<void>
  importLocal: (places: Place[]) => Promise<number>
  leaveAnemone: (id: string) => void
  setJourney: (i: number, playing?: boolean) => void
  celebrate: () => void
  replayIntro: () => void
}

export const useStore = create<State>((set, get) => ({
  phase: linkedToPlace() ? "day" : "intro",
  light: "morning",
  seed: seed as Place[],
  local: [],
  tributes: {},
  selectedId: linkedPlaceId(),
  hoveredId: null,
  tab: "places",
  query: "",
  addOpen: false,
  aboutOpen: false,
  aboutSection: null,
  searchOpen: false,
  picking: false,
  draft: null,
  journeyIndex: -1,
  journeyPlaying: false,
  celebration: 0,
  introRun: 0,

  init: async () => {
    const [local, tributes] = await Promise.all([loadLocal(), loadTributes()])
    set({ local, tributes })
  },
  setPhase: (phase) => set({ phase }),
  setLight: (light) => set({ light }),
  select: (selectedId) => set({ selectedId }),
  hover: (hoveredId) => set({ hoveredId }),
  setTab: (tab) => set({ tab, selectedId: tab === "journey" ? get().selectedId : null }),
  setQuery: (query) => set({ query }),
  setAddOpen: (addOpen) => set({ addOpen, picking: addOpen ? get().picking : false, draft: addOpen ? get().draft : null }),
  setAboutOpen: (aboutOpen) => set({ aboutOpen, aboutSection: null }),
  openAbout: (aboutSection) => set({ aboutOpen: true, aboutSection, searchOpen: false }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setPicking: (picking) => set({ picking }),
  setDraft: (draft) => set({ draft }),
  addLocal: async (p) => {
    const local = [...get().local, p]
    set({ local })
    await saveLocal(local)
  },
  removeLocal: async (id) => {
    const local = get().local.filter((p) => p.id !== id)
    set({ local, selectedId: get().selectedId === id ? null : get().selectedId })
    await saveLocal(local)
  },
  importLocal: async (incoming) => {
    const known = new Set(get().local.map((p) => p.id))
    const valid = incoming.filter(
      (p) => p && typeof p.id === "string" && !known.has(p.id) && Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.name_he,
    )
    const local = [...get().local, ...valid.map((p) => ({ ...p, coord_source: "community" as const }))]
    set({ local })
    await saveLocal(local)
    return valid.length
  },
  leaveAnemone: (id) => {
    const tributes = { ...get().tributes, [id]: (get().tributes[id] ?? 0) + 1 }
    set({ tributes })
    void saveTributes(tributes)
  },
  celebrate: () => set({ celebration: get().celebration + 1 }),
  replayIntro: () => {
    try {
      localStorage.removeItem(INTRO_SEEN)
    } catch {
      /* private mode */
    }
    // Leave no place in the address, or the morning would reopen it.
    history.replaceState(null, "", "#/")
    set({
      phase: "intro",
      light: "morning",
      selectedId: null,
      hoveredId: null,
      journeyIndex: -1,
      journeyPlaying: false,
      aboutOpen: false,
      searchOpen: false,
      introRun: get().introRun + 1,
    })
  },
  setJourney: (journeyIndex, playing) => set({ journeyIndex, journeyPlaying: playing ?? get().journeyPlaying }),
}))

export const allPlaces = (s: Pick<State, "seed" | "local">) => [...s.seed, ...s.local]

export function normalize(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[֑-ׇ]/g, "")
    .replace(/["'״׳\-–]/g, " ")
    .toLowerCase()
    .trim()
}

export function matches(p: Place, q: string) {
  const n = normalize(q)
  if (!n) return true
  const hay = normalize([p.name_he, p.place_he, p.summary_he, p.local?.inMemoryOf].filter(Boolean).join(" "))
  return n.split(/\s+/).every((t) => hay.includes(t))
}

/**
 * The journey runs north to south along Route 232. Each stop is at least 1.5 km from the last:
 * a community where there is one, otherwise the most significant memorial nearby.
 */
export function journeyStops(places: Place[]): Place[] {
  const rank = (p: Place) =>
    p.id === "nova-memorial-reim" ? -1 : p.kind === "community" ? 0 : p.kind === "site" || p.kind === "monument" ? 1 : 2
  const near = (a: Place, b: Place) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 95) < 1.5
  const chosen: Place[] = []
  places
    .filter((p) => p.region === "envelope" && p.lat < 31.66 && p.lat > 31.15)
    .sort((a, b) => rank(a) - rank(b) || b.lat - a.lat)
    .forEach((p) => {
      if (!chosen.some((q) => near(p, q))) chosen.push(p)
    })
  return chosen.sort((a, b) => b.lat - a.lat)
}

/** Memorial sites in or right around a community, for its "memory" section. */
export function sitesNear(community: Place, places: Place[], km = 2.5) {
  return places.filter(
    (p) => p.id !== community.id && p.kind !== "community" && Math.hypot((p.lat - community.lat) * 111, (p.lng - community.lng) * 95) < km,
  )
}
