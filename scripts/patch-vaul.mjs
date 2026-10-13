// The existing vaul 1.1.2 modal-context fix, without the patch-package/glob dependency tree.
// Fail closed on unexpected upstream bytes instead of guessing at a new version's internals.
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

export const FILES = {
  "index.js": [
    "f08e063abe20413cb56c59c398b497b98e13c6963d672b4c7d942b9c131d5a63",
    "b8bbe18ba5720cbfb106099e776d72cec8e9b4d58ec097a4e4264a4d93f4f215",
  ],
  "index.mjs": [
    "1b454bba44e985997bfa34821cbf61a21ca42530bb4a3a4040300a2fcedc2d40",
    "b38b56ba1e3692913a0b30a9ce8add9b81a321ebb4a776c71edf2d081b58f47b",
  ],
}
const hash = (text) => createHash("sha256").update(text).digest("hex")
export function patch(source, hashes) {
  if (hash(source) === hashes[1]) return source
  if (hash(source) !== hashes[0]) throw new Error("Unexpected vaul bytes: review its modal-context fix before updating")
  const result = source.replace("        open: isOpen\n", "        open: isOpen,\n        modal: modal\n")
  if (hash(result) !== hashes[1]) throw new Error("Vaul patch output did not match the reviewed fix")
  return result
}
export function apply() {
  if (JSON.parse(readFileSync(new URL("../node_modules/vaul/package.json", import.meta.url))).version !== "1.1.2")
    throw new Error("Review the Vaul fix before changing version")
  for (const [file, hashes] of Object.entries(FILES)) {
    const path = new URL(`../node_modules/vaul/dist/${file}`, import.meta.url)
    const before = readFileSync(path, "utf8")
    const after = patch(before, hashes)
    if (after !== before) writeFileSync(path, after)
  }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) apply()
