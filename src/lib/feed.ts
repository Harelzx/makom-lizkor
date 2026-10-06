import { Feed, isNewer, PublicPlace } from "@/shared/contract"
import { retryWaiting } from "@/lib/outbox"
import { loadSnapshot, loadUnlisted, relistPublished, saveSnapshot } from "@/lib/storage"
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
    contributedPhoto: p.photo,
    accessNote: p.access_note,
    links: p.link_url ? [{ label_he: "אתר הנצחה", url: p.link_url }] : [],
    coord_source: "contribution",
    region: p.lat < 31.7 && p.lng < 34.75 && p.lat > 31.1 ? "envelope" : "country",
  }
}

/** The approved place a share page carries (its public fields, written by the Worker), so its card opens at once. */
function carried(): Place | null {
  const text = document.getElementById("place-data")?.textContent
  if (!text) return null
  try {
    const p = PublicPlace.safeParse(JSON.parse(text))
    return p.success ? toPlace(p.data) : null
  } catch {
    return null
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
      // Nothing newer: what is shown is current, and now known to be, even if it came from the offline copy.
      if (mine && !isNewer(v, mine)) return void (!useStore.getState().feedLive && useStore.setState({ feedLive: true }))
      const res = await fetch(`/api/v1/feed?v=${encodeURIComponent(v)}`, { cache: "no-store" })
      // The version moved between the two requests: ask once more, then wait for the next wake.
      if (res.status === 409 && retry) {
        busy = false
        return void (await check(false))
      }
      if (!res.ok) return
      const feed = Feed.parse(await res.json())
      const current = useStore.getState().feedVersion
      if (!current || isNewer(feed.v, current)) {
        useStore.getState().setRemote(feed.v, feed.places.map(toPlace))
        // The newest feed replaces the offline copy whole: nothing hidden since lingers in it.
        void saveSnapshot(feed)
        // Places a share page had said weren't public, which this feed lists: the server's word now holds.
        void relistPublished(feed.places.map((p) => p.id))
      }
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
  // The place a share page carries stands until a feed comes; the server's feed then replaces it with everything else.
  const shared = carried()
  if (shared && !useStore.getState().feedVersion) useStore.setState({ remote: [shared] })
  // With no connection yet, the last feed this browser received fills the map; a newer one replaces it whole. An
  // offline copy older than the shared place keeps it: only the server's own feed can say it is gone.
  // Places this browser learned aren't public (a share page said so) stay off it, across reloads.
  void Promise.all([loadSnapshot(), loadUnlisted()]).then(([saved, unlisted]) => {
    const snapshot = Feed.safeParse(saved)
    const current = useStore.getState().feedVersion
    if (!snapshot.success || (current && !isNewer(snapshot.data.v, current))) return
    const off = new Set(unlisted)
    const places = snapshot.data.places.filter((p) => !off.has(p.id)).map(toPlace)
    if (shared && !places.some((p) => p.id === shared.id)) places.push(shared)
    useStore.getState().setRemote(snapshot.data.v, places, false)
  })
  onWake()
  return () => {
    clearInterval(timer)
    document.removeEventListener("visibilitychange", onWake)
    window.removeEventListener("focus", onWake)
    window.removeEventListener("online", onWake)
  }
}
