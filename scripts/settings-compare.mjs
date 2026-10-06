// How .claude/settings.json changed between two commits, structurally (adviser a51, E6-SETTINGS-1): the exact deny
// rules added and removed, whether the hooks are unchanged, and every other setting compared whole. For a reviewer
// who can't read the file itself.
//   node scripts/settings-compare.mjs <base> <head>
import { execFileSync } from "node:child_process"
import { isDeepStrictEqual } from "node:util"
import { pathToFileURL } from "node:url"

export function compareSettings(base, head) {
  const deny = (s) => s?.permissions?.deny ?? []
  const otherPermissions = (s) => Object.fromEntries(Object.entries(s?.permissions ?? {}).filter(([k]) => k !== "deny"))
  const keys = [...new Set([...Object.keys(base), ...Object.keys(head)])].filter((k) => k !== "permissions" && k !== "hooks").sort()
  return {
    denyAdded: deny(head).filter((r) => !deny(base).includes(r)),
    denyRemoved: deny(base).filter((r) => !deny(head).includes(r)),
    hooksUnchanged: isDeepStrictEqual(base.hooks ?? null, head.hooks ?? null),
    otherPermissionsUnchanged: isDeepStrictEqual(otherPermissions(base), otherPermissions(head)),
    otherSettings: Object.fromEntries(keys.map((k) => [k, isDeepStrictEqual(base[k], head[k]) ? "unchanged" : "changed"])),
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, head] = process.argv.slice(2)
  if (!base || !head) {
    console.error("usage: node scripts/settings-compare.mjs <base> <head>")
    process.exit(2)
  }
  const read = (rev) => JSON.parse(execFileSync("git", ["show", `${rev}:.claude/settings.json`], { encoding: "utf8" }))
  const commit = (rev) => execFileSync("git", ["rev-parse", `${rev}^{commit}`], { encoding: "utf8" }).trim()
  console.log(JSON.stringify({ base: commit(base), head: commit(head), ...compareSettings(read(base), read(head)) }, null, 2))
}
