// Known credential formats in tracked/new non-ignored text. Findings print location/rule only, never the secret.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

export const RULES = {
  private_pem: /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g,
  aws_access: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  github_token: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/g,
  google_client_secret: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/g,
  google_refresh: /\b1\/\/[A-Za-z0-9_-]{80,}\b/g,
  google_access: /\bya29\.[A-Za-z0-9_-]{50,}\b/g,
  cloudflare_api_key: /["']?(?:CLOUDFLARE_API_KEY|X-Auth-Key)["']?\s*[:=]\s*["'][a-f0-9]{37}["']/gi,
}
export function findings(text) {
  return Object.entries(RULES).flatMap(([rule, expression]) =>
    [...text.matchAll(expression)].map((match) => ({ rule, line: text.slice(0, match.index).split("\n").length })),
  )
}
export function scan() {
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
  const problems = []
  for (const file of new Set(files)) {
    // Binary asset formats do not contain source/config credentials; no ignored/private directory is traversed.
    if (/\.(png|webp|jpe?g|gif|woff2?|wasm|mp[34]|wav|ogg|pdf|zip)$/i.test(file)) continue
    let text
    try {
      text = readFileSync(file, "utf8")
    } catch {
      continue
    }
    for (const found of findings(text)) problems.push({ file, ...found })
  }
  return problems
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = scan()
  if (problems.length) {
    console.error(JSON.stringify({ credential_findings: problems }))
    process.exitCode = 1
  } else console.log("Known-format credential scan passed; ignored/private files were not read.")
}
