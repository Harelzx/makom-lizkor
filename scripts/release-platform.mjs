// Release gate (spec 11, 13): what the platform itself must not do in production, read from wrangler.jsonc as wrangler
// reads it. No side door around Access (version preview URLs; the workers.dev address is covered by the Worker's own Access); no request logs or traces of
// the platform's own, which would hold the addresses, headers and bodies our log lines leave out; every bucket at rest in
// the EU. The D1 databases' location is set when they are created (--jurisdiction eu), not in this file: an account step.
export function platformBlockers(raw) {
  const blockers = []
  // The workers.dev address may stay on (production has served there since 11 October 2026, and old links name it):
  // Access protects the Worker itself, on every address it answers at, and each release checks that against the live
  // Access app (release-workers-access.mjs). It must be stated either way, never left to wrangler's default.
  if (typeof raw.workers_dev !== "boolean") blockers.push("workers_dev must be set explicitly (true or false), not left to the default")
  if (raw.preview_urls !== false) blockers.push("preview_urls must be false: version preview URLs would bypass Access")
  if (raw.observability?.logs?.invocation_logs !== false)
    blockers.push("observability.logs.invocation_logs must be false: only our own structured log lines are kept")
  if (raw.observability?.traces?.enabled === true) blockers.push("tracing must stay off until its attributes are checked for personal data")
  for (const b of raw.r2_buckets ?? [])
    if (b.jurisdiction !== "eu") blockers.push(`bucket ${b.binding} must be in the EU (jurisdiction "eu")`)
  return blockers
}
