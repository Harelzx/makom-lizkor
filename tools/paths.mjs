// Where things live. The tools are in git, but the launch assets and source art they read and write stay in the project
// folder around the main checkout, out of git. From a parallel worktree `..` is not that folder, so it's found through
// the shared git dir instead.
import path from "node:path"
import { checkout } from "../scripts/parallel/lib.mjs"
import { checkoutPorts } from "../scripts/parallel/ports.mjs"

const co = checkout(import.meta.dirname)
export const repo = co.root // this checkout: web/ or one of its worktrees
export const project = path.resolve(co.commonDir, "../..") // the folder holding web/, launch/, assets-src/ and app/
export const launch = path.join(project, "launch")
export const assets = path.join(project, "assets-src")
// This checkout's preview server (5190 in the main checkout, its own port in a worktree), so a tool films this checkout's code.
export const previewUrl = `http://localhost:${checkoutPorts(co.root).e2e}/`
