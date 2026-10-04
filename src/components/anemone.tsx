import { useId } from "react"
import { motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

/**
 * Anemone coronaria, the kalanit of the western Negev, drawn in SVG.
 * Two rings of tepals (a darker back ring and a lighter front ring) with veins and a sheen,
 * the pale ring at their base, a dark domed heart, and a crown of stamens.
 * `state` drives the bloom: a closed bud, an open flower, or open and lifted when selected.
 */
export type AnemoneState = "bud" | "open" | "selected"

// One tepal, pointing up from the center: broad, slightly cupped, with a soft dip at the tip.
export const TEPAL =
  "M0 -2 C -9 -8 -23 -19 -23 -35 C -23 -47 -13 -54 -4 -52 C -2 -51.5 -1 -50.6 0 -50 C 1 -50.6 2 -51.5 4 -52 C 13 -54 23 -47 23 -35 C 23 -19 9 -8 0 -2 Z"
const VEINS = [
  "M0 -6 C -1 -20 -2 -34 -1 -48",
  "M0 -6 C -6 -18 -12 -30 -14 -44",
  "M0 -6 C 6 -18 12 -30 14 -44",
  "M0 -8 C -10 -18 -17 -26 -20 -36",
  "M0 -8 C 10 -18 17 -26 20 -36",
]

export const PALETTES = {
  crimson: { base: "#3d040e", deep: "#860a1f", mid: "#cc0f2b", tip: "#e8293f", sheen: "#ff8d98", vein: "#5e0716", ring: "#f7f1e8" },
  pale: { base: "#5b3a42", deep: "#94606b", mid: "#d9a2ab", tip: "#f1cdd2", sheen: "#ffffff", vein: "#8c5a64", ring: "#fbf8f3" },
}

interface Props {
  state?: AnemoneState
  size?: number
  delay?: number
  className?: string
  /** A softer flower for places families added on this device. */
  variant?: keyof typeof PALETTES
  /** "lite" drops veins and filaments for the dozens of flowers drawn on the map at once. */
  detail?: "full" | "lite"
}

export function Anemone({ state = "open", size = 32, delay = 0, className, variant = "crimson", detail = "full" }: Props) {
  const lite = detail === "lite"
  const id = useId().replace(/[:«»]/g, "")
  const reduce = useReducedMotion()
  const open = state !== "bud"
  const lift = state === "selected"
  const c = PALETTES[variant]
  const spring = (d: number) => (reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 110, damping: 13, mass: 0.9, delay: d })

  // Back ring sits between the front tepals and is a shade darker, which gives the flower its depth.
  const rings = [
    { angles: [30, 150, 270], scale: 1, fill: `url(#b${id})`, d: 0, shadow: false },
    { angles: [90, 210, 330], scale: 0.93, fill: `url(#f${id})`, d: 0.12, shadow: true },
  ]
  // The shadow between the rings is worth its cost only where it can be seen.
  const depth = size >= 48
  const count = lite ? 12 : 26
  const stamens = Array.from({ length: count }, (_, k) => {
    const a = (k / count) * Math.PI * 2 + (k % 2) * 0.06
    const r = 12.5 + (k % 3) * 1.4
    return { x1: Math.cos(a) * 7.5, y1: Math.sin(a) * 7.5, x2: Math.cos(a) * r, y2: Math.sin(a) * r }
  })

  return (
    <motion.svg
      viewBox="-60 -60 120 120"
      width={size}
      height={size}
      className={cn("overflow-visible", className)}
      aria-hidden="true"
      initial={false}
      style={{ originX: "50%", originY: "50%" }}
      animate={{ scale: lift ? 1.16 : 1, y: lift ? -3 : 0, rotate: lift ? -6 : 0 }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 240, damping: 17 }}
    >
      <defs>
        <radialGradient id={`f${id}`} cx="0" cy="0" r="54" gradientUnits="userSpaceOnUse">
          <stop offset="0.08" stopColor={c.base} />
          <stop offset="0.3" stopColor={c.deep} />
          <stop offset="0.62" stopColor={c.mid} />
          <stop offset="1" stopColor={c.tip} />
        </radialGradient>
        <radialGradient id={`b${id}`} cx="0" cy="0" r="54" gradientUnits="userSpaceOnUse">
          <stop offset="0.08" stopColor={c.base} />
          <stop offset="0.35" stopColor={c.base} />
          <stop offset="0.7" stopColor={c.deep} />
          <stop offset="1" stopColor={c.mid} />
        </radialGradient>
        {/* light catching the upper edge of each tepal */}
        <linearGradient id={`s${id}`} x1="0" y1="-52" x2="0" y2="-20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={c.sheen} stopOpacity="0.55" />
          <stop offset="1" stopColor={c.sheen} stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`r${id}`} cx="0" cy="0" r="17" gradientUnits="userSpaceOnUse">
          <stop offset="0.45" stopColor={c.ring} stopOpacity="1" />
          <stop offset="0.8" stopColor={c.ring} stopOpacity="0.55" />
          <stop offset="1" stopColor={c.ring} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`h${id}`} cx="-2.5" cy="-3" r="9" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5a5f86" />
          <stop offset="0.45" stopColor="#262a45" />
          <stop offset="1" stopColor="#0d0f1e" />
        </radialGradient>
        <filter id={`d${id}`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="2.2" floodColor="#2a0008" floodOpacity="0.45" />
        </filter>
        <radialGradient id={`g${id}`} cx="0" cy="0" r="60" gradientUnits="userSpaceOnUse">
          <stop offset="0.35" stopColor={c.mid} stopOpacity="0.45" />
          <stop offset="1" stopColor={c.mid} stopOpacity="0" />
        </radialGradient>
      </defs>

      {lift && <circle r="60" fill={`url(#g${id})`} />}

      {rings.map((ring) =>
        ring.angles.map((angle, i) => (
          // The outer group places the tepal; the inner one opens it, pivoting on its base.
          <g key={`${ring.d}-${angle}`} transform={`rotate(${angle})`} filter={depth && ring.shadow ? `url(#d${id})` : undefined}>
            <motion.g
              style={{ transformBox: "fill-box", originX: "50%", originY: "100%" }}
              initial={false}
              animate={{
                rotate: open ? 0 : -angle * 0.94 + (angle > 180 ? 360 * 0.94 : 0),
                scaleX: open ? ring.scale : 0.26,
                scaleY: open ? ring.scale : 0.42,
              }}
              transition={spring(delay + (open ? ring.d + i * 0.05 : 0))}
            >
              <path d={TEPAL} fill={ring.fill} />
              <path d={TEPAL} fill={`url(#s${id})`} />
              {!lite &&
                VEINS.map((v) => (
                  <path key={v} d={v} fill="none" stroke={c.vein} strokeOpacity="0.22" strokeWidth="0.7" strokeLinecap="round" />
                ))}
              <path d={TEPAL} fill="none" stroke={c.base} strokeOpacity="0.35" strokeWidth="0.6" />
            </motion.g>
          </g>
        )),
      )}

      {/* the bud's closed sheath, visible only before the bloom */}
      <motion.g
        style={{ transformBox: "fill-box", originX: "50%", originY: "100%" }}
        initial={false}
        animate={{ opacity: open ? 0 : 1, scale: open ? 0.6 : 1 }}
        transition={reduce ? { duration: 0 } : { duration: 0.35, delay: open ? delay : 0 }}
      >
        <ellipse cx="0" cy="-6" rx="9" ry="15" fill={`url(#b${id})`} />
        <path d="M-7 -8 C -6 -16 -3 -21 0 -22 C 3 -21 6 -16 7 -8" fill="none" stroke={c.tip} strokeOpacity="0.5" strokeWidth="1" />
      </motion.g>

      {/* the pale ring, the stamens, the dark heart */}
      <motion.g
        style={{ transformBox: "fill-box", originX: "50%", originY: "50%" }}
        initial={false}
        animate={{ scale: open ? 1 : 0.2, opacity: open ? 1 : 0 }}
        transition={reduce ? { duration: 0 } : { delay: delay + 0.28, type: "spring", stiffness: 160, damping: 15 }}
      >
        <circle r="17" fill={`url(#r${id})`} />
        {stamens.map((s, k) => (
          <g key={k}>
            {!lite && <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#2a2d48" strokeWidth="0.7" strokeOpacity="0.8" />}
            <circle cx={s.x2} cy={s.y2} r={k % 3 === 0 ? 1.9 : 1.5} fill="#151729" />
          </g>
        ))}
        <circle r="7.6" fill={`url(#h${id})`} />
        <circle cx="-2.4" cy="-2.8" r="1.6" fill="#ffffff" opacity="0.28" />
      </motion.g>
    </motion.svg>
  )
}
