import { Feed, isNewer, type PublicPlace } from "@/shared/contract"
import { retryWaiting } from "@/lib/outbox"
import { useStore } from "@/store"
import type { Place } from "@/types"

const EVERY_MS = 30_000

function toPlace(p: PublicPlace): Place {
  return {
    id: p.id,
    name_he: p.name_he,
    kind: p.kind,
    lat: p.lat,
    lng: p.lng,
    precision: p.precision,
    place_he: p.place_he || "נוסף על ידי משפחה או חברים",
    summary_he: p.summary_he,
    inMemoryOf: p.in_memory_of,
    links: p.link_url ? [{ label_he: "אתר הנצחה", url: p.link_url }] : [],
    coord_source: "contribution",
    region: p.lat < 31.7 && p.lng < 34.75 && p.lat > 31.1 ? "envelope" : "country",
  }
}

/**
 * Keeps the approved places current while the tab is in view: every 30 seconds, and at once whenever the tab
 * comes back, the window gets focus or the connection returns. A newer version replaces the list whole.
 */
export function startFeedSync(): () => void {
  let busy = false
  const check = async (retry = true): Promise<void> => {
    if (busy || document.visibilityState !== "visible") return
    busy = true
    try {
      const { v } = (await (await fetch("/api/v1/version", { cache: "no-store" })).json()) as { v: string }
      const mine = useStore.getState().feedVersion
      if (mine && !isNewer(v, mine)) return
      const res = await fetch(`/api/v1/feed?v=${encodeURIComponent(v)}`, { cache: "no-store" })
      // The version moved between the two requests: ask once more, then wait for the next wake.
      if (res.status === 409 && retry) {
        busy = false
        return void (await check(false))
      }
      if (!res.ok) return
      const feed = Feed.parse(await res.json())
      if (!mine || isNewer(feed.v, mine)) useStore.getState().setRemote(feed.v, feed.places.map(toPlace))
    } catch {
      /* offline or the server is down: the map keeps what it already shows */
    } finally {
      busy = false
    }
  }
  // The same wakes send again any place of the visitor's that couldn't reach the server.
  const onWake = () => {
    void check()
    void retryWaiting()
  }
  const timer = setInterval(onWake, EVERY_MS)
  document.addEventListener("visibilitychange", onWake)
  window.addEventListener("focus", onWake)
  window.addEventListener("online", onWake)
  onWake()
  return () => {
    clearInterval(timer)
    document.removeEventListener("visibilitychange", onWake)
    window.removeEventListener("focus", onWake)
    window.removeEventListener("online", onWake)
  }
}
