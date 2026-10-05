// Keeps .dev.vars in step with the committed template: creates it when missing, and adds any key the template has gained
// since (a new secret for development) without touching the values already there, which may be a developer's own.
import { appendFileSync, copyFileSync, existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const target = resolve(root, ".dev.vars")
const template = resolve(root, ".dev.vars.example")
const keys = (text) => new Set(text.split("\n").flatMap((line) => (/^([A-Z_]+)=/.exec(line) ? [/^([A-Z_]+)=/.exec(line)[1]] : [])))

if (!existsSync(target)) {
  copyFileSync(template, target)
  console.log("dev-vars: created .dev.vars from .dev.vars.example")
} else {
  const have = keys(readFileSync(target, "utf8"))
  const missing = readFileSync(template, "utf8")
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line) && !have.has(line.slice(0, line.indexOf("="))))
  if (missing.length) {
    appendFileSync(target, `\n# Added from .dev.vars.example\n${missing.join("\n")}\n`)
    console.log(`dev-vars: added ${missing.map((l) => l.slice(0, l.indexOf("="))).join(", ")} to .dev.vars`)
  }
}
