import { expect, it, vi } from "vitest"
import type { Place } from "@/types"

const sent = vi.hoisted(() => ({ ids: [] as string[], gate: null as Promise<void> | null }))
vi.mock("@/lib/storage", () => ({
  loadLocal: async () => [],
  loadTributes: async () => ({}),
  saveTributes: async () => undefined,
  changeLocal: async () => {
    throw new DOMException("blocked", "SecurityError")
  },
}))
vi.mock("@/lib/api", () => ({
  submitPlace: async (input: { name_he: string }) => {
    sent.ids.push(input.name_he)
    if (sent.gate) await sent.gate
    return { ok: false, kind: "temporary" }
  },
  uploadPhoto: async () => "ok",
}))

const { useStore } = await import("@/store")
const { retryWaiting } = await import("@/lib/outbox")

const waiting = (id: string): Place =>
  ({
    id,
    name_he: id,
    kind: "bench",
    lat: 31.4,
    lng: 34.5,
    local: { send: "waiting", submitKey: `k-${id}`, submission: { name_he: id } },
  }) as Place

it("a place removed while an earlier one is being sent is not sent", async () => {
  useStore.setState({ local: [waiting("local-1"), waiting("local-2")] })
  // The first send hangs; temporary results stop the loop, so make the first one 'sent' instead.
  let release!: () => void
  sent.gate = new Promise((r) => (release = r))
  const api = await import("@/lib/api")
  vi.spyOn(api, "submitPlace").mockImplementation(async (input) => {
    sent.ids.push(input.name_he)
    if (sent.gate) await sent.gate
    return { ok: true, id: `p_${input.name_he}`, trackingToken: "t" }
  })
  const run = retryWaiting()
  await vi.waitFor(() => expect(sent.ids).toEqual(["local-1"]))
  await useStore.getState().removeLocal("local-2")
  release()
  await run
  expect(sent.ids).toEqual(["local-1"])
})

it("a place once answered keeps no key that could ask the server for its tracking link again", async () => {
  useStore.setState({ local: [waiting("local-3"), waiting("local-4")] })
  sent.gate = null
  const api = await import("@/lib/api")
  vi.spyOn(api, "submitPlace").mockImplementation(async (input) =>
    input.name_he === "local-3" ? { ok: true, id: "p_3", trackingToken: "t" } : { ok: false, kind: "rejected", code: "invalid" },
  )
  await retryWaiting()
  const [sentPlace, refused] = useStore.getState().local
  expect(sentPlace.local).toMatchObject({ send: "sent", remoteId: "p_3" })
  expect(sentPlace.local?.submitKey).toBeUndefined()
  expect(refused.local?.send).toBe("rejected")
  expect(refused.local?.submitKey).toBeUndefined()
})
