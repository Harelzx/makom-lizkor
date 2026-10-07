// What a failed release attempt left in production, from its steps' outcomes. release.yml runs this when any step
// fails or the run is cancelled, so whoever opens the run reads the state before choosing what to do. It knows only
// this attempt: an earlier attempt of the same release may have deployed it and left it live, unverified and a draft
// (L-RELEASE-STATE-1), so a summary that deployed nothing never names what is live; it says where to look. An outcome
// it doesn't recognise is read as "may have happened": a failed final check is not proof that nothing was deployed.
//   node scripts/release-outcome.mjs <release> <migrated> <deployed> <checked> <published>

const ran = (outcome) => outcome !== "skipped"
const done = (outcome) => outcome === "success"

export function releaseOutcome({ release, migrated, deployed, checked, published }) {
  const lines = [`## ${release}: this attempt failed`, ""]
  // What is live when this attempt deployed nothing: not known from here.
  const look = [
    `An earlier attempt of ${release} may have left it live and unverified: what is live is not known from this run.`,
    "Read `wrangler deployments list` for the active version, and the attempt records",
    `(release-attempt-${release}-<attempt>) and their checks, before choosing rollback.yml (code only, schema-checked) or a fix forward.`,
  ]
  if (!ran(migrated) && !ran(deployed)) {
    lines.push("It stopped before the migrations. This attempt changed nothing in production; the release stays a draft.", ...look)
  } else if (!done(migrated)) {
    lines.push(
      "The migrations failed: the migrations may be partly applied. This attempt deployed no code.",
      "Check the schema against this run's Time Travel bookmark first; the release stays a draft.",
      ...look,
    )
  } else if (!ran(deployed)) {
    lines.push(
      "The migrations were applied. The deploy never ran. This attempt deployed no code; whatever is live now runs on",
      "the schema it migrated (the migrations are expand-only). The release stays a draft.",
      ...look,
    )
  } else if (!done(deployed)) {
    lines.push(
      "The migrations were applied. The deploy did not finish cleanly, so the code may or may not have changed:",
      `read \`wrangler deployments list\` to see whether ${release} is the active version. The release stays a draft.`,
    )
  } else if (!done(checked)) {
    lines.push(
      `${release} is live in production and not verified: the production checks failed after the deploy.`,
      "The release stays a draft. Next: run rollback.yml to the last verified release (code only; the schema stays),",
      "or fix forward with a new release. Either way, read the checks' output above first.",
    )
  } else {
    lines.push(
      `${release} is live and verified; only publishing the release failed (${published}).`,
      `Publish it by hand: \`gh release edit ${release} --draft=false\`.`,
    )
  }
  return lines.join("\n") + "\n"
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [release, migrated, deployed, checked, published] = process.argv.slice(2)
  process.stdout.write(releaseOutcome({ release, migrated, deployed, checked, published }))
}
