import { expect, it } from "vitest"
import { placeId, sameHash, sha256Hex, ulid } from "../lib/ids"
import { isNewer } from "@/shared/contract"

it("makes time-sortable ids", () => {
  expect(ulid(1000) < ulid(2000)).toBe(true)
  expect(placeId()).toMatch(/^p_[0-9A-HJKMNP-TV-Z]{26}$/)
})
it("compares token hashes", async () => {
  const h = await sha256Hex("abc")
  expect(await sameHash(h, await sha256Hex("abc"))).toBe(true)
  expect(await sameHash(h, await sha256Hex("abd"))).toBe(false)
})
it("orders feed versions by epoch first", () => {
  expect(isNewer("0.3", "0.2")).toBe(true)
  expect(isNewer("1.0", "0.9")).toBe(true)
  expect(isNewer("0.2", "0.2")).toBe(false)
})
