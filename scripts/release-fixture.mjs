// A throwaway git repository for the release scripts' tests: files written and committed by name, with a fixed
// synthetic identity, so the tests run the same in CI and on a machine with no git user.
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.test",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.test",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
}

export function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "release-fixture-"))
  const git = (...args) => execFileSync("git", args, { cwd: dir, env: ENV, encoding: "utf8" }).trim()
  git("init", "-q", "-b", "main")
  return {
    dir,
    /** Writes the files (null removes one), commits them, and returns the commit. */
    commit(message, files) {
      for (const [path, text] of Object.entries(files)) {
        const full = join(dir, path)
        if (text === null) rmSync(full)
        else {
          mkdirSync(dirname(full), { recursive: true })
          writeFileSync(full, text)
        }
      }
      git("add", "-A")
      git("commit", "-q", "--allow-empty", "-m", message)
      return git("rev-parse", "HEAD")
    },
    branch: (name, from) => git("checkout", "-q", "-b", name, from),
    tag: (name, at) => git("tag", name, at),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  }
}
