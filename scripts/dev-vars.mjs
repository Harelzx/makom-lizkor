// Creates .dev.vars from the committed template when it is missing, so a fresh checkout runs in development locally.
// An existing .dev.vars is never touched: it may hold a developer's own synthetic values.
import { copyFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const target = resolve(root, ".dev.vars")
if (!existsSync(target)) {
  copyFileSync(resolve(root, ".dev.vars.example"), target)
  console.log("dev-vars: created .dev.vars from .dev.vars.example")
}
