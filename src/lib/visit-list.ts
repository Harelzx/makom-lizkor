import { create } from "zustand"
import { changeSavedVisits, loadSavedVisits } from "@/lib/storage"
import type { Place } from "@/types"

/** IDs only: a hidden place's story or private tracking link never stays in this list. */
export const visitKey = (place: Place) => place.local?.remoteId ?? place.id

export function nextPlace(current: Place, places: Place[]) {
  return places
    .filter((p) => p.kind !== "community" && !p.local && p.id !== current.id)
    .sort((a, b) => {
      const distance = (p: Place) => Math.hypot((p.lat - current.lat) * 111, (p.lng - current.lng) * 95)
      return distance(a) - distance(b) || a.id.localeCompare(b.id)
    })[0]
}

type Visits = {
  ids: string[]
  ready: boolean
  busy: boolean
  filter: "all" | "saved"
  init: () => Promise<void>
  setFilter: (filter: "all" | "saved") => void
  toggle: (id: string) => Promise<boolean>
}
let initializing: Promise<void> | undefined
export const useVisits = create<Visits>((set, get) => ({
  ids: [],
  ready: false,
  busy: false,
  filter: "all",
  init: () =>
    (initializing ??= loadSavedVisits().then((ids) => {
      set({ ids: ids ?? [], ready: true })
    })),
  setFilter: (filter) => set({ filter }),
  toggle: async (id) => {
    await get().init()
    if (get().busy) return false
    set({ busy: true })
    try {
      const ids = await changeSavedVisits((stored) => (stored.includes(id) ? stored.filter((key) => key !== id) : [...stored, id]))
      set({ ids })
      return true
    } catch {
      // No false promise of persistence. The unchanged button lets the visitor try again.
      return false
    } finally {
      set({ busy: false })
    }
  },
}))
