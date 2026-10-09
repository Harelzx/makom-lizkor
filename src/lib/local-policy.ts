import type { Place } from "@/types"

/** Old versions persisted unsuccessful sends. Keep these off the map and discard them instead of resending. */
export const unacceptedLocal = (p: Place) => !!p.local?.send && ["sending", "waiting", "rejected"].includes(p.local.send)
