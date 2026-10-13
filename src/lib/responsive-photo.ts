/** Variants use the same live, suppression-checked URL and never a public bucket or external image service. */
export const PHOTO_SIZES = "(max-width: 639px) calc(100vw - 40px), 520px"
export function photoSrcSet(url: string): string | undefined {
  if (!/^\/media\/public\/[^/?]+\/[^/?]+$/.test(url)) return undefined
  // Cards are at most 520 CSS px. Offer the bounded card sizes even on 3x phones; keep src as the original fallback.
  // Original dimensions vary, so inventing a 1600w descriptor would both misstate them and select large files on phones.
  return `${url}?w=640 640w, ${url}?w=960 960w`
}
