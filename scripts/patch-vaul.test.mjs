import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { FILES, patch } from "./patch-vaul.mjs"

test("the original patch is reproduced exactly for both module formats and is idempotent", () => {
  for (const [file, hashes] of Object.entries(FILES)) {
    const after = readFileSync(new URL(`../node_modules/vaul/dist/${file}`, import.meta.url), "utf8")
    const before = after.replace("        open: isOpen,\n        modal: modal\n", "        open: isOpen\n")
    assert.equal(createHash("sha256").update(before).digest("hex"), hashes[0])
    assert.equal(patch(before, hashes), after)
    assert.equal(patch(after, hashes), after)
    assert.throws(() => patch(before + "\n", hashes), /Unexpected/)
  }
})
