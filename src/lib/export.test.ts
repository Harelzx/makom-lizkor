import { expect, it } from "vitest"
import { exportable, importable } from "@/lib/export"
import type { Place } from "@/types"

const sent = {
  id: "local-1",
  name_he: "ספסל דמו",
  kind: "bench",
  lat: 31.4,
  lng: 34.5,
  local: {
    send: "waiting",
    submitKey: "key",
    trackingToken: "token",
    remoteId: "p_1",
    submission: { name_he: "ספסל דמו", email: "a@example.test", submitter_name: "דמו" },
  },
} as unknown as Place

it("an exported file carries no key, tracking link, email or name", () => {
  const [p] = exportable([sent])
  expect(JSON.stringify(p)).not.toMatch(/key|token|example\.test|"דמו"|p_1/)
  expect(p.name_he).toBe("ספסל דמו")
})

it("an imported place is never sent on its own", () => {
  const [p] = importable([sent])
  expect(p.local?.send).toBeUndefined()
  expect(p.local?.submitKey).toBeUndefined()
  expect(p.local?.submission).toBeUndefined()
})
