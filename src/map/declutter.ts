/** A screen box, in pixels. */
export type Box = { x: number; y: number; w: number; h: number }
export type Side = "start" | "end" | "below" | "above" | "none"
type Name = { id: string; dot: Box; w: number; h: number }
export type Placement = { side: Side; over: boolean }

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h

/**
 * Where each community's name goes: on the reading side of its dot (west, in Hebrew), else on the other side, below
 * or above it. With flowers on all four, it stays on the reading side, over them (`over`): a memorial map should not
 * lose Be'eri's name to its own flowers. It waits for a closer zoom only when other names and dots leave it no room.
 * The markers are DOM elements, so the map's own label collisions never see them; this is that pass, for the names.
 */
export function placeNames(names: Name[], flowers: Box[], bounds: Box, gap: number): Map<string, Placement> {
  const labels = names.map((n) => n.dot)
  const placed = new Map<string, Placement>()
  for (const n of names) {
    const y = n.dot.y + n.dot.h / 2 - n.h / 2
    const x = n.dot.x + n.dot.w / 2 - n.w / 2
    const sides: [Side, Box][] = [
      ["start", { x: n.dot.x - gap - n.w, y, w: n.w, h: n.h }],
      ["end", { x: n.dot.x + n.dot.w + gap, y, w: n.w, h: n.h }],
      ["below", { x, y: n.dot.y + n.dot.h + gap / 3, w: n.w, h: n.h }],
      ["above", { x, y: n.dot.y - gap / 3 - n.h, w: n.w, h: n.h }],
    ]
    const fits = ([, b]: [Side, Box], over: Box[]) => inside(b, bounds) && !over.some((t) => overlaps(b, t))
    const clear = sides.find((s) => fits(s, [...flowers, ...labels]))
    const amongFlowers = clear ? undefined : sides.find((s) => fits(s, labels))
    const chosen = clear ?? amongFlowers
    placed.set(n.id, chosen ? { side: chosen[0], over: !clear } : { side: "none", over: false })
    if (chosen) labels.push(chosen[1])
  }
  return placed
}
