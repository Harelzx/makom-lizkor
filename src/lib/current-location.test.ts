import { afterEach, expect, test, vi } from "vitest"
import { LOCATION_WAIT_MS, requestCurrentLocation, type LocationUpdate } from "./current-location"

afterEach(() => vi.useRealTimers())

function setup(secure = true) {
  vi.useFakeTimers()
  const updates: LocationUpdate[] = []
  let success!: PositionCallback
  let failure!: PositionErrorCallback
  const getCurrentPosition = vi.fn((onSuccess: PositionCallback, onError?: PositionErrorCallback | null) => {
    success = onSuccess
    failure = onError!
  })
  const cancel = requestCurrentLocation({ secure, geolocation: { getCurrentPosition } }, (r) => updates.push(r))
  return {
    updates,
    success: () => success({ coords: { latitude: 31.42, longitude: 34.51 } } as GeolocationPosition),
    failure,
    cancel,
    getCurrentPosition,
  }
}

test("an insecure connection reports the cause without asking the provider", () => {
  const { updates, getCurrentPosition } = setup(false)
  expect(getCurrentPosition).not.toHaveBeenCalled()
  expect(updates).toEqual([{ kind: "error", message: expect.stringContaining("החיבור אינו מאובטח") }])
})

test("unsupported browsers have a map fallback", () => {
  const update = vi.fn()
  requestCurrentLocation({ secure: true }, update)
  expect(update).toHaveBeenCalledWith({ kind: "error", message: expect.stringContaining("לא תומך") })
})

test("a silent provider times out once and its late success cannot replace a chosen pin", () => {
  const { updates, success } = setup()
  expect(updates).toEqual([{ kind: "locating" }])
  vi.advanceTimersByTime(LOCATION_WAIT_MS)
  expect(updates[1]).toEqual({ kind: "error", message: expect.stringContaining("יותר מדי זמן") })
  success()
  vi.advanceTimersByTime(LOCATION_WAIT_MS)
  expect(updates).toHaveLength(2)
})

test("closing or picking manually cancels the watchdog and ignores a late position", () => {
  const { updates, success, cancel } = setup()
  cancel()
  success()
  vi.advanceTimersByTime(LOCATION_WAIT_MS)
  expect(updates).toEqual([{ kind: "locating" }])
})

test.each([1, 2, 3])("provider error %i has a specific explanation and no later timeout", (code) => {
  const { updates, failure } = setup()
  failure({ code } as GeolocationPositionError)
  vi.advanceTimersByTime(LOCATION_WAIT_MS)
  expect(updates).toHaveLength(2)
  expect(updates[1]).toEqual({
    kind: "error",
    message: expect.stringContaining(code === 1 ? "חסומה" : code === 2 ? "לא הצליח לקבוע" : "יותר מדי זמן"),
  })
})

test("a successful position finishes once and releases the timeout", () => {
  const { updates, success } = setup()
  success()
  success()
  vi.advanceTimersByTime(LOCATION_WAIT_MS)
  expect(updates).toEqual([{ kind: "locating" }, { kind: "found", point: { lat: 31.42, lng: 34.51 } }])
})

test("a synchronous browser exception still leaves a visible error", () => {
  const update = vi.fn()
  requestCurrentLocation(
    {
      secure: true,
      geolocation: {
        getCurrentPosition: () => {
          throw new Error("provider unavailable")
        },
      },
    },
    update,
  )
  expect(update).toHaveBeenLastCalledWith({ kind: "error", message: expect.stringContaining("לא הצליח לקבוע") })
})
