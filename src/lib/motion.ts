// Motion presets: every animation in the interface draws from these, so movement feels like one hand.
export const ease = [0.22, 1, 0.36, 1] as const

export const spring = {
  /** panels, sheets, larger surfaces */
  soft: { type: "spring", stiffness: 260, damping: 30, mass: 1 },
  /** chips, toggles, indicators */
  snappy: { type: "spring", stiffness: 520, damping: 38, mass: 0.8 },
  /** small celebratory moments: a flower left, a step completed */
  bouncy: { type: "spring", stiffness: 300, damping: 16, mass: 0.8 },
} as const

export const duration = { fast: 0.16, base: 0.28, slow: 0.5, scene: 1.2 } as const

/** Content entering a panel: a short rise and fade. */
export const enter = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: duration.base, ease },
}

/** Lists: children arrive one after another, quickly. */
export const stagger = (i: number, step = 0.025, cap = 14) => ({ delay: Math.min(i, cap) * step })
