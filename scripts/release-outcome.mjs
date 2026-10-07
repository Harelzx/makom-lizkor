// What a failed release left in production, from its steps' outcomes. release.yml runs this
// when any step fails, so whoever opens the run reads the state before choosing what to do.
// An outcome it doesn't recognise is read as "may have happened": a failed final check is not
// proof that nothing was deployed.
//   node scripts/release-outcome.mjs <release> <migrated> <deployed> <checked> <published>

const ran = (outcome) => outcome !== "skipped"
const done = (outcome) => outcome === "success"

export function releaseOutcome({ release, migrated, deployed, checked, published }) {
  const lines = [`## ${release}: the release failed`, ""]
  if (!ran(migrated) && !ran(deployed)) {
    lines.push("It stopped before the migrations. Nothing in production changed; the release stays a draft.")
  } else if (!done(migrated)) {
    lines.push(
      "The migrations failed: the migrations may be partly applied. The code is still the previous release's.",
      "Check the schema against the Time Travel bookmark in this run's artifacts before anything else; the release stays a draft.",
    )
  } else if (!ran(deployed)) {
    lines.push(
      "The migrations were applied. The deploy never ran: production serves the previous release's code on the new schema.",
      "The migrations are expand-only, so that code still works on it. The release stays a draft; run it again, or fix forward.",
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
