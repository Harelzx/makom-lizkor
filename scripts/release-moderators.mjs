// The moderators' addresses: every alert (a removal request waiting, a stalled retention job) goes only to them, so an
// empty list would let a request or a stuck deletion go unnoticed. The database is run as an individual's (the operator
// and at most two more people may use it; docs/database-definitions.md), so the list never holds more than three.
export const MAX_MODERATORS = 3

export function moderatorBlockers(raw) {
  const list = (raw.vars?.MODERATORS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
  if (!list.length) return ["MODERATORS is empty in wrangler.jsonc: no one would be alerted to a request or a stalled deletion job"]
  const blockers = []
  for (const e of list)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || /@(.+\.)?(example\.(com|net|org)|example|test|invalid|localhost)$/i.test(e))
      blockers.push(`MODERATORS holds ${e}, which is not a real address`)
  if (new Set(list.map((e) => e.toLowerCase())).size > MAX_MODERATORS)
    blockers.push(`MODERATORS names more than ${MAX_MODERATORS} people: the database may have the operator and at most two more`)
  return blockers
}
