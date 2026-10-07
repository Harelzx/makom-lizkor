/**
 * What staging's synthetic machine moderator may touch (Harel's approval H1, 7 October 2026): only places that say,
 * in every name they were ever sent under, that they are synthetic, so it can never act on a real memorial or show a
 * made-up one as genuine; and only the few routes a submission's approval, publication and removal need. Everything
 * else a moderator can do (the site's own places, reports and their contact details, the attention list, media) is
 * a person's alone.
 *
 * The check and the change must see the same place (H1-SYNTHETIC-RACE-1): a correction lands as a new revision in the
 * same batch that moves the place's rev on, so the check reads the rev with the revisions in one statement, a change
 * must name exactly that rev, and the change's own compare-and-set on rev then refuses anything that moved in between.
 */

/** The prefix a synthetic place's name carries, visible wherever the name shows. */
export const SYNTHETIC_MARK = "[סינתטי] "

const CONTRIBUTION = /^p_[0-9A-Z]{26}$/

/**
 * The place's rev when it is synthetic (a contribution, every one of its revisions named with the mark), read in one
 * statement; null when it isn't, or isn't there. The site's own places never are.
 */
export async function syntheticRev(db: D1Database, placeId: string): Promise<number | null> {
  if (!CONTRIBUTION.test(placeId)) return null
  const row = await db
    .prepare(
      `SELECT p.rev AS rev,
         (SELECT COUNT(*) FROM revisions r WHERE r.place_id = p.id) AS n,
         (SELECT COUNT(*) FROM revisions r WHERE r.place_id = p.id AND substr(r.name_he, 1, ?2) = ?3) AS marked
       FROM places p WHERE p.id = ?1`,
    )
    .bind(placeId, [...SYNTHETIC_MARK].length, SYNTHETIC_MARK)
    .first<{ rev: number; n: number; marked: number }>()
  return row && row.n > 0 && row.marked === row.n ? row.rev : null
}

export const syntheticPlace = async (db: D1Database, placeId: string) => (await syntheticRev(db, placeId)) !== null

/**
 * Whether the machine moderator may make this request: the queue (which then lists synthetic places only), a
 * synthetic place's view (re-checked once read: the route), and its approval or return, a hide or a lift, each naming
 * as expectedRev the very rev that was found synthetic. The path is the admin router's own. `rev` is what was checked.
 */
export async function machineMay(
  db: D1Database,
  method: string,
  path: string,
  body: () => Promise<unknown>,
): Promise<{ ok: boolean; rev: number | null }> {
  const no = { ok: false, rev: null }
  if (method === "GET" && path === "/queue") return { ok: true, rev: null }
  // A change names the rev it was made against; it must be the one found synthetic.
  const at = async (placeId: unknown) => {
    if (typeof placeId !== "string") return no
    const rev = await syntheticRev(db, placeId)
    const expected = ((await body().catch(() => null)) as { expectedRev?: unknown } | null)?.expectedRev
    return rev !== null && expected === rev ? { ok: true, rev } : no
  }
  let m = /^\/places\/([^/]+)$/.exec(path)
  if (method === "GET" && m) {
    const rev = await syntheticRev(db, decodeURIComponent(m[1]))
    return rev === null ? no : { ok: true, rev }
  }
  m = /^\/places\/([^/]+)\/transitions$/.exec(path)
  if (method === "POST" && m) return at(decodeURIComponent(m[1]))
  if (method === "POST" && path === "/suppressions") return at(((await body().catch(() => null)) as { placeId?: unknown } | null)?.placeId)
  m = /^\/suppressions\/([^/]+)\/lift$/.exec(path)
  if (method === "POST" && m) {
    const placeId = await db
      .prepare("SELECT place_id FROM field_suppressions WHERE id = ?")
      .bind(decodeURIComponent(m[1]))
      .first<string>("place_id")
    return at(placeId)
  }
  return no
}
