/**
 * Two lights over the same land: 06:29 on 7.10.2023 (the blue hour before sunrise),
 * and the morning after. Every map color is listed here so the sunrise can tween all of them together.
 */
export interface Palette {
  land: string
  farmland: string
  wood: string
  park: string
  water: string
  urban: string
  building: string
  roadMinor: string
  roadMajor: string
  roadCasing: string
  border: string
  label: string
  labelStrong: string
  halo: string
  hillShadow: string
  hillHighlight: string
  hillAccent: string
  sky: string
  horizon: string
  fog: string
}

// Night: the ink scale (see --p-ink-* in index.css), with a rose-violet line of first light.
export const NIGHT: Palette = {
  land: "#18213a",
  farmland: "#1a2440",
  wood: "#172238",
  park: "#19253b",
  water: "#0d1426",
  urban: "#1f2946",
  building: "#29334d",
  roadMinor: "#232d48",
  roadMajor: "#2e3a5a",
  roadCasing: "#131a2c",
  border: "#566181",
  label: "#8b94ae",
  labelStrong: "#cfd5e2",
  halo: "#131a2c",
  hillShadow: "#060913",
  hillHighlight: "#3a4566",
  hillAccent: "#0f1526",
  sky: "#070b19",
  horizon: "#6b4763",
  fog: "#262844",
}

// First light: the few minutes between, warm and golden-rose. The sunrise passes through it on its way to morning, so
// the map never goes through grey (night and morning mixed straight meet at a dull grey half way).
export const FIRST_LIGHT: Palette = {
  land: "#7d5f52",
  farmland: "#836451",
  wood: "#6f5a4f",
  park: "#7a5f52",
  water: "#6b6487",
  urban: "#8a6a5e",
  building: "#9a786a",
  roadMinor: "#a07c6c",
  roadMajor: "#c39478",
  roadCasing: "#4a3a3c",
  border: "#b08a86",
  label: "#e3c2b0",
  labelStrong: "#fff0e2",
  halo: "#4a3a3c",
  hillShadow: "#3a2a2e",
  hillHighlight: "#f0b48a",
  hillAccent: "#5e4a48",
  sky: "#6f5a8a",
  horizon: "#ffb878",
  fog: "#c99a8a",
}

// Morning: the western Negev in winter, when the anemones bloom: green fields, pale sky-blue water, white roads.
export const MORNING: Palette = {
  land: "#e5eedb",
  farmland: "#d6e6c5",
  wood: "#bdd6ad",
  park: "#cfe2c0",
  water: "#b3d3ea",
  urban: "#e8ece6",
  building: "#d9dfdc",
  roadMinor: "#ffffff",
  roadMajor: "#ffffff",
  roadCasing: "#c9d5c0",
  border: "#7c86a1",
  label: "#4e5a74",
  labelStrong: "#1c253b",
  halo: "#ffffff",
  hillShadow: "#4f6447",
  hillHighlight: "#ffffff",
  hillAccent: "#9bb28d",
  sky: "#a6cbe6",
  horizon: "#ffe9d3",
  fog: "#e5eedb",
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
const toHex = (v: number[]) => "#" + v.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")

export function mix(a: string, b: string, t: number) {
  const A = hex(a)
  const B = hex(b)
  return toHex(A.map((x, i) => x + (B[i] - x) * t))
}

export function mixPalette(a: Palette, b: Palette, t: number): Palette {
  const out = {} as Palette
  for (const k of Object.keys(a) as (keyof Palette)[]) out[k] = mix(a[k], b[k], t)
  return out
}

/** A sunrise isn't linear: the sky warms first, the land follows. */
export const easeSunrise = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
