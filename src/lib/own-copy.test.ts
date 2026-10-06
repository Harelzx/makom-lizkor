import { beforeEach, expect, it, vi } from "vitest"
import type { Place } from "@/types"

const server = vi.hoisted(() => ({ byToken: {} as Record<string, unknown> }))
vi.mock("@/lib/storage", () => ({
  loadLocal: async () => [],
  loadTributes: async () => ({}),
  saveTributes: async () => undefined,
  changeLocal: async (change: (stored: Place[]) => Place[]) => change([]),
}))
vi.mock("@/lib/api", () => ({ trackSubmission: async (_id: string, token: string) => server.byToken[token] }))

const { useStore } = await import("@/store")
const { settleOwnCopy } = await import("@/lib/own-copy")

const own = (send = "sent"): Place =>
  ({ id: "local-1", name_he: "x", kind: "bench", lat: 31.4, lng: 34.5, local: { send, remoteId: "p_1", trackingToken: "own" } }) as Place
const copy = () => useStore.getState().local[0].local!

beforeEach(() => {
  server.byToken = {}
  useStore.setState({ local: [own()] })
})

it("withdrawn through the mailed link, whose status then 404s, the copy asks with its own link and lets it go", async () => {
  server.byToken.own = { status: "withdrawn", name_he: null }
  await settleOwnCopy("p_1", "mailed", null)
  expect(copy()).toMatchObject({ send: "withdrawn" })
  expect(copy().trackingToken).toBeUndefined()
})

it("keeps the link while the withdrawal's files wait to be erased, so the view can finish them", async () => {
  await settleOwnCopy("p_1", "own", { status: "withdrawn", name_he: null, files: "pending" })
  expect(copy()).toMatchObject({ send: "withdrawn", trackingToken: "own" })
})

it("lets the link go once the place is erased, or the server no longer knows it by this link", async () => {
  await settleOwnCopy("p_1", "own", { status: "erased", name_he: null })
  expect(copy().trackingToken).toBeUndefined()
  useStore.setState({ local: [own()] })
  await settleOwnCopy("p_1", "own", null)
  expect(copy().trackingToken).toBeUndefined()
})

it("changes nothing when the status couldn't be read, or the place is still there", async () => {
  await settleOwnCopy("p_1", "own", undefined)
  await settleOwnCopy("p_1", "own", { status: "published", name_he: "x" })
  server.byToken.own = undefined
  await settleOwnCopy("p_1", "mailed", null)
  expect(copy()).toMatchObject({ send: "sent", trackingToken: "own" })
})
