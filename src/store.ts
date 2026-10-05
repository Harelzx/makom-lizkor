import { create } from "zustand"
import seed from "@/data/places.json"
import type { LocalFields, Place } from "@/types"
import { loadLocal, loadTributes, saveLocal, saveTributes } from "@/lib/storage"

/** intro: 06:29, the dark map and the opening words · dawn: the sunrise is playing · day: the site itself */
export type Phase = "intro" | "dawn" | "day"
export type Tab = "places" | "communities" | "journey"
export type Light = "morning" | "night"

/** Set once the opening has been seen through; later visits go straight to the name. */
export const INTRO_SEEN = "makom-lizkor:v2-seen"
/** A shared link to a place lands on that place: the opening is for those who come in through the front door. */
// A tracking link (#/track/<id>/<token>) is opened for its status, so it skips the opening too.
const linkedToPlace = () => typeof location !== "undefined" && /^#\/(place|track|verify)\/[^/]+/.test(location.hash)
/** The place a shared link names, chosen before the first render so the address is never rewritten under it. */
const linkedPlaceId = () => {
  if (!linkedToPlace() || !location.hash.startsWith("#/place/")) return null
  const id = decodeURIComponent(location.hash.split("/")[2])
  // Local places and approved contributions (p_…) load after the first render, so their ids are trusted.
  return id.startsWith("local-") || id.startsWith("p_") || (seed as Place[]).some((p) => p.id === id) ? id : null
}

interface State {
  phase: Phase
  light: Light
  seed: Place[]
  /** Contributions a moderator approved, from the server's feed. */
  remote: Place[]
  feedVersion: string | null
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
  /** The submission whose status is open, from its private tracking link. Kept here, never in the address. */
  tracking: { id: string; token: string } | null
  /** An email verification link's secret, while its confirmation page is open. Never kept in the address. */
  verifying: string | null
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
  setTracking: (t: { id: string; token: string } | null) => void
  setVerifying: (token: string | null) => void
  setSearchOpen: (v: boolean) => void
  setPicking: (v: boolean) => void
  setDraft: (p: { lat: number; lng: number } | null) => void
  setRemote: (v: string, places: Place[]) => void
  /** Both keep the change in memory and say whether it was also saved on the device; they never throw. */
  addLocal: (p: Place) => Promise<boolean>
  updateLocal: (id: string, patch: Partial<LocalFields>) => Promise<boolean>
  removeLocal: (id: string) => Promise<void>
  importLocal: (places: Place[]) => Promise<number>
  leaveAnemone: (id: string) => void
  setJourney: (i: number, playing?: boolean) => void
  celebrate: () => void
  replayIntro: () => void
}

/** Saves the visitor's places on the device; false when the browser won't keep them (a private window, a full disk). */
const persist = (local: Place[]) =>
  saveLocal(local).then(
    () => true,
    () => false,
  )

export const useStore = create<State>((set, get) => ({
  phase: linkedToPlace() ? "day" : "intro",
  light: "morning",
  seed: seed as Place[],
  remote: [],
  feedVersion: null,
  local: [],
  tributes: {},
  selectedId: linkedPlaceId(),
  hoveredId: null,
  tab: "places",
  query: "",
  addOpen: false,
  aboutOpen: false,
  aboutSection: null,
  tracking: null,
  verifying: null,
  searchOpen: false,
  picking: false,
  draft: null,
  journeyIndex: -1,
  journeyPlaying: false,
  celebration: 0,
  introRun: 0,

  init: async () => {
    const [stored, tributes] = await Promise.all([loadLocal(), loadTributes()])
    // A place still "sending" is from a visit that closed mid-send; nothing is sending it now, so it waits for a retry.
    const local = stored.map((p) => (p.local?.send === "sending" ? { ...p, local: { ...p.local, send: "waiting" as const } } : p))
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
  setTracking: (tracking) => set({ tracking, searchOpen: false }),
  setVerifying: (verifying) => set({ verifying, searchOpen: false }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setPicking: (picking) => set({ picking }),
  setDraft: (draft) => set({ draft }),
  setRemote: (feedVersion, remote) => set({ feedVersion, remote }),
  addLocal: async (p) => {
    const local = [...get().local, p]
    set({ local })
    return persist(local)
  },
  updateLocal: async (id, patch) => {
    const local = get().local.map((p) => (p.id === id && p.local ? { ...p, local: { ...p.local, ...patch } } : p))
    set({ local })
    return persist(local)
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

/** Seed, approved places from the server, and this device's own places; once its place is approved, the local copy steps aside. */
export const allPlaces = (s: Pick<State, "seed" | "remote" | "local">) => {
  const published = new Set(s.remote.map((p) => p.id))
  return [...s.seed, ...s.remote, ...s.local.filter((p) => !p.local?.remoteId || !published.has(p.local.remoteId))]
}

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
  const hay = normalize([p.name_he, p.place_he, p.summary_he, p.inMemoryOf ?? p.local?.inMemoryOf].filter(Boolean).join(" "))
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
