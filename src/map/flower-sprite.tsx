import { PALETTES, TEPAL } from "@/components/anemone"

/**
 * The map's flowers are drawn once, here, as SVG symbols; every marker is a two-line <use>.
 * Seventy markers then cost seventy tiny nodes instead of seventy full drawings, and the bloom
 * is a CSS transition on each marker rather than JavaScript springs.
 * Kept in the layout at 0×0 (not display:none) so its gradients stay paintable.
 */
function Flower({ id, palette }: { id: string; palette: keyof typeof PALETTES }) {
  const c = PALETTES[palette]
  const stamens = Array.from({ length: 12 }, (_, k) => {
    const a = (k / 12) * Math.PI * 2
    const r = 12.5 + (k % 2) * 1.4
    return [Math.cos(a) * r, Math.sin(a) * r]
  })
  return (
    <symbol id={id} viewBox="-60 -60 120 120" overflow="visible">
      <defs>
        <radialGradient id={`${id}-f`} cx="0" cy="0" r="54" gradientUnits="userSpaceOnUse">
          <stop offset="0.08" stopColor={c.base} />
          <stop offset="0.3" stopColor={c.deep} />
          <stop offset="0.62" stopColor={c.mid} />
          <stop offset="1" stopColor={c.tip} />
        </radialGradient>
        <radialGradient id={`${id}-b`} cx="0" cy="0" r="54" gradientUnits="userSpaceOnUse">
          <stop offset="0.35" stopColor={c.base} />
          <stop offset="0.7" stopColor={c.deep} />
          <stop offset="1" stopColor={c.mid} />
        </radialGradient>
        <linearGradient id={`${id}-s`} x1="0" y1="-52" x2="0" y2="-20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={c.sheen} stopOpacity="0.5" />
          <stop offset="1" stopColor={c.sheen} stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-sh`} cx="0" cy="0" r="1" gradientTransform="translate(0 8) scale(50 44)" gradientUnits="userSpaceOnUse">
          <stop offset="0.55" stopColor="#3c0a14" stopOpacity="0.3" />
          <stop offset="1" stopColor="#3c0a14" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-r`} cx="0" cy="0" r="17" gradientUnits="userSpaceOnUse">
          <stop offset="0.45" stopColor={c.ring} />
          <stop offset="1" stopColor={c.ring} stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* a soft contact shadow, painted rather than filtered */}
      <ellipse cx="0" cy="8" rx="50" ry="44" fill={`url(#${id}-sh)`} />
      {[30, 150, 270].map((a) => (
        <g key={a} transform={`rotate(${a})`}>
          <path d={TEPAL} fill={`url(#${id}-b)`} />
        </g>
      ))}
      {[90, 210, 330].map((a) => (
        <g key={a} transform={`rotate(${a}) scale(0.93)`}>
          <path d={TEPAL} fill={`url(#${id}-f)`} stroke={c.base} strokeOpacity="0.35" strokeWidth="0.6" />
          <path d={TEPAL} fill={`url(#${id}-s)`} />
        </g>
      ))}
      <circle r="17" fill={`url(#${id}-r)`} />
      {stamens.map(([x, y], k) => (
        <circle key={k} cx={x} cy={y} r="1.8" fill="#151729" />
      ))}
      <circle r="7.6" fill="#1d2036" />
      <circle cx="-2.4" cy="-2.8" r="1.6" fill="#fff" opacity="0.28" />
    </symbol>
  )
}

export function FlowerSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <Flower id="mk-crimson" palette="crimson" />
      <Flower id="mk-pale" palette="pale" />
      <symbol id="mk-bud" viewBox="-60 -60 120 120" overflow="visible">
        <ellipse cx="0" cy="-4" rx="11" ry="17" fill="#6e0a1c" />
        <path d="M-8 -6 C -7 -15 -3 -20 0 -21 C 3 -20 7 -15 8 -6" fill="none" stroke="#e8293f" strokeOpacity="0.6" strokeWidth="1.4" />
      </symbol>
    </svg>
  )
}
