import { expect, it } from "vitest"
import { placeNames, type Box } from "./declutter"

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h })
const bounds = box(0, 0, 400, 800)
const name = (id: string, x: number, y: number, w = 40) => ({ id, dot: box(x - 4, y - 4, 8, 8), w, h: 16 })
const sideOf = (...args: Parameters<typeof placeNames>) => {
  const p = placeNames(...args).get("a")!
  return p.over ? `${p.side} over` : p.side
}

it("puts a name on the reading side of its dot when that side is free", () => {
  expect(sideOf([name("a", 200, 100)], [], bounds, 6)).toBe("start")
})

it("moves a name to the dot's other side when a flower sits on the reading side", () => {
  const flower = box(140, 90, 20, 20) // west of the dot, where a Hebrew name runs
  expect(sideOf([name("a", 200, 100)], [flower], bounds, 6)).toBe("end")
})

it("tries below and then above the dot when both sides are taken", () => {
  const sides = [box(140, 94, 20, 12), box(210, 94, 20, 12)]
  expect(sideOf([name("a", 200, 100)], sides, bounds, 6)).toBe("below")
  const under = box(180, 104, 40, 20)
  expect(sideOf([name("a", 200, 100)], [...sides, under], bounds, 6)).toBe("above")
})

it("keeps a community named among flowers: on its reading side, over them, rather than hidden", () => {
  const all = [box(140, 94, 20, 12), box(210, 94, 20, 12), box(180, 104, 40, 20), box(180, 76, 40, 20)]
  expect(sideOf([name("a", 200, 100)], all, bounds, 6)).toBe("start over")
})

it("never lets two names cover each other, and hides a name only when names and dots leave it no room", () => {
  const two = placeNames([name("a", 200, 100), name("b", 200, 110)], [], bounds, 6)
  expect(two.get("a")!.side).toBe("start")
  expect(two.get("b")!.side).toBe("end")
  const ring = [name("n", 150, 100), name("e", 250, 100), name("s", 200, 125), name("u", 200, 75)]
  const crowded = placeNames([...ring, name("a", 200, 100)], [], bounds, 6)
  expect(crowded.get("a")!.side).toBe("none")
})

it("keeps a name inside the map rather than cut by its edge", () => {
  expect(sideOf([name("a", 20, 100)], [], bounds, 6)).toBe("end")
})

it("does not let one name land on another community's dot", () => {
  expect(placeNames([name("a", 200, 100), name("b", 170, 100)], [], bounds, 6).get("a")!.side).toBe("end")
})
