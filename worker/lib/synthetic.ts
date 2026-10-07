/**
 * What staging's synthetic machine moderator may touch (Harel's approval H1, 7 October 2026): only places that say,
 * in every name they were ever sent under, that they are synthetic, so it can never act on a real memorial or show a
 * made-up one as genuine; and only the few routes a submission's approval, publication and removal need. Everything
 * else a moderator can do (the site's own places, reports and their contact details, the attention list, media) is
 * a person's alone.
 */

/** The prefix a synthetic place's name carries, visible wherever the name shows. */
export const SYNTHETIC_MARK = "[סינתטי] "

const CONTRIBUTION = /^p_[0-9A-Z]{26}$/

/** A contribution every one of whose revisions is named with the mark; the site's own places never are. */
export async function syntheticPlace(db: D1Database, placeId: string): Promise<boolean> {
  if (!CONTRIBUTION.test(placeId)) return false
  const row = await db
    .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(substr(name_he, 1, ?2) = ?3), 0) AS marked FROM revisions WHERE place_id = ?1")
    .bind(placeId, [...SYNTHETIC_MARK].length, SYNTHETIC_MARK)
    .first<{ n: number; marked: number }>()
  return !!row && row.n > 0 && row.marked === row.n
}

/**
 * Whether the machine moderator may make this request: the queue (which then lists synthetic places only), a
 * synthetic place's view and its approval or return, and a hide or lift of one. The path is the admin router's own.
 */
export async function machineMay(db: D1Database, method: string, path: string, body: () => Promise<unknown>): Promise<boolean> {
  if (method === "GET" && path === "/queue") return true
  let m = /^\/places\/([^/]+)$/.exec(path)
  if (method === "GET" && m) return syntheticPlace(db, decodeURIComponent(m[1]))
  m = /^\/places\/([^/]+)\/transitions$/.exec(path)
  if (method === "POST" && m) return syntheticPlace(db, decodeURIComponent(m[1]))
  if (method === "POST" && path === "/suppressions") {
    const placeId = ((await body().catch(() => null)) as { placeId?: unknown } | null)?.placeId
    return typeof placeId === "string" && syntheticPlace(db, placeId)
  }
  m = /^\/suppressions\/([^/]+)\/lift$/.exec(path)
  if (method === "POST" && m) {
    const placeId = await db
      .prepare("SELECT place_id FROM field_suppressions WHERE id = ?")
      .bind(decodeURIComponent(m[1]))
      .first<string>("place_id")
    return !!placeId && syntheticPlace(db, placeId)
  }
  return false
}
