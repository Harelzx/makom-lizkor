/**
 * Atmosphere over the opening.
 * "embers": in the blue hour, warm motes rise slowly and flicker.
 * "petals": at sunrise, anemone petals let go and drift up with the light.
 * Every particle is a small element animated with CSS transform/opacity keyframes, which run on the
 * compositor: no canvas to re-upload each frame, no JavaScript per frame. Off with reduced motion.
 */
type Mode = "embers" | "petals" | "off"

const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const EMBER = ["#ffce96", "#ffaa78", "#ffe2be", "#f04a5c"]
const PETAL = ["#d71a33", "#b70f28", "#f04a5c", "#8e0c21"]

// Each visit gets its own scatter, drawn once when the module loads rather than on every render.
const makeEmbers = (n: number) =>
  Array.from({ length: n }, () => ({
    left: rnd(0, 100),
    size: rnd(2, 5),
    dur: rnd(14, 26),
    delay: -rnd(0, 26),
    sway: rnd(-40, 40),
    color: EMBER[(Math.random() * EMBER.length) | 0],
    flicker: rnd(1.8, 3.6),
  }))
const makePetals = (n: number) =>
  Array.from({ length: n }, () => ({
    left: rnd(15, 105),
    top: rnd(70, 110),
    size: rnd(12, 24),
    dx: rnd(-520, -120),
    dy: rnd(-900, -480),
    rot: rnd(-260, 260),
    dur: rnd(4.2, 6.4),
    delay: rnd(0, 1.6),
    color: PETAL[(Math.random() * PETAL.length) | 0],
  }))
const EMBERS = { small: makeEmbers(18), large: makeEmbers(34) }
const PETALS = { small: makePetals(16), large: makePetals(30) }

export function Atmosphere({ mode }: { mode: Mode }) {
  const small = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const embers = small ? EMBERS.small : EMBERS.large
  const petals = small ? PETALS.small : PETALS.large

  if (reduce || mode === "off") return null

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {mode === "embers" &&
        embers.map((e, i) => (
          <span
            key={i}
            className="atmo-ember"
            style={
              {
                left: `${e.left}%`,
                width: e.size,
                height: e.size,
                "--sway": `${e.sway}px`,
                "--c": e.color,
                animationDuration: `${e.dur}s`,
                animationDelay: `${e.delay}s`,
              } as React.CSSProperties
            }
          >
            <i style={{ animationDuration: `${e.flicker}s` }} />
          </span>
        ))}
      {mode === "petals" &&
        petals.map((p, i) => (
          <svg
            key={i}
            className="atmo-petal"
            viewBox="-10 -22 20 22"
            width={p.size}
            height={p.size}
            style={
              {
                left: `${p.left}%`,
                top: `${p.top}%`,
                "--dx": `${p.dx}px`,
                "--dy": `${p.dy}px`,
                "--rot": `${p.rot}deg`,
                animationDuration: `${p.dur}s`,
                animationDelay: `${p.delay}s`,
              } as React.CSSProperties
            }
          >
            <path d="M0 0 C -9 -4 -13 -14 -8 -20 C -4 -24 4 -24 8 -20 C 13 -14 9 -4 0 0 Z" fill={p.color} />
          </svg>
        ))}
    </div>
  )
}
