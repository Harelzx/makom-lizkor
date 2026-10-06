import { afterAll, expect } from "vitest"
import { logLineProblems } from "../lib/log"

// Every line written while a test file runs is checked against the log schema (spec 11), so the rule holds on every
// path the tests reach, not only on examples. A test's own evidence output goes through `evidence` instead.
const seen: string[] = []
const raw = { log: console.log, info: console.info, warn: console.warn, error: console.error }
for (const method of ["log", "info", "warn", "error"] as const)
  console[method] = (...args: unknown[]) => {
    const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
    for (const problem of logLineProblems(text)) seen.push(`${problem}: ${text.slice(0, 200)}`)
    raw[method](...args)
  }

/** A test's own output for the evidence folder, outside the Worker's log. */
export const evidence = (text: string) => raw.log(text)

afterAll(() => {
  expect(seen, "log lines outside the schema").toEqual([])
})
