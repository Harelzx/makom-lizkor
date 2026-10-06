// Release gate (spec 11, 13): what the platform itself must not do in production, read from wrangler.jsonc as wrangler
// reads it. No side door around Access (the workers.dev address, version preview URLs); no request logs or traces of
// the platform's own, which would hold the addresses, headers and bodies our log lines leave out; every bucket at rest in
// the EU. The D1 databases' location is set when they are created (--jurisdiction eu), not in this file: an account step.
export function platformBlockers(raw) {
  const blockers = []
  if (raw.workers_dev !== false) blockers.push("workers_dev must be false: the workers.dev address would bypass Access")
  if (raw.preview_urls !== false) blockers.push("preview_urls must be false: version preview URLs would bypass Access")
  if (raw.observability?.logs?.invocation_logs !== false)
    blockers.push("observability.logs.invocation_logs must be false: only our own structured log lines are kept")
  if (raw.observability?.traces?.enabled === true) blockers.push("tracing must stay off until its attributes are checked for personal data")
  for (const b of raw.r2_buckets ?? [])
    if (b.jurisdiction !== "eu") blockers.push(`bucket ${b.binding} must be in the EU (jurisdiction "eu")`)
  return blockers
}
