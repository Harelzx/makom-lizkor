import { beforeEach, expect, it, vi } from "vitest"
import type { Place } from "@/types"

const disk = vi.hoisted(() => ({ places: [] as Place[] }))
vi.mock("@/lib/storage", () => ({
  loadLocal: async () => disk.places,
  loadTributes: async () => ({}),
  saveTributes: async () => undefined,
  changeLocal: async (fn: (rows: Place[]) => Place[]) => (disk.places = fn(disk.places)),
}))
vi.mock("@/lib/api", () => ({ submitPlace: vi.fn(), uploadPhoto: vi.fn(async () => "ok") }))
const { useStore } = await import("@/store")
const { retryWaiting } = await import("@/lib/outbox")
const api = await import("@/lib/api")
const place = (id: string, send: "sending" | "waiting" | "rejected" | "sent"): Place =>
  ({
    id,
    name_he: id,
    kind: "bench",
    lat: 31.4,
    lng: 34.5,
    local: { send, submitKey: `k-${id}`, submission: { name_he: id } },
  }) as Place
beforeEach(() => {
  vi.clearAllMocks()
  disk.places = []
  useStore.setState({ local: [] })
})

it("an upgrade discards old unsuccessful submissions from disk and never resends them", async () => {
  const accepted = place("local-accepted", "sent")
  disk.places = [place("local-a", "sending"), place("local-b", "waiting"), place("local-c", "rejected"), accepted]
  await useStore.getState().init()
  await retryWaiting()
  expect(api.submitPlace).not.toHaveBeenCalled()
  expect(disk.places).toEqual([accepted])
  expect(useStore.getState().local).toEqual([accepted])
})
it("the outbox retries only the photo of an accepted place and discards legacy queued records", async () => {
  const accepted = place("local-photo", "sent")
  Object.assign(accepted.local!, { remoteId: "p_photo", trackingToken: "own", photo: "data:image/jpeg;base64,abc", photoAlt: "דמו" })
  useStore.setState({ local: [place("local-old", "waiting"), accepted] })
  await retryWaiting()
  expect(api.submitPlace).not.toHaveBeenCalled()
  expect(api.uploadPhoto).toHaveBeenCalledTimes(1)
  expect(useStore.getState().local).toHaveLength(1)
  expect(useStore.getState().local[0].local?.photoSent).toBe(true)
})
