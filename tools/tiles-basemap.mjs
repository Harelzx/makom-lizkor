// Builds the map's basemap: one PMTiles archive of Israel in the OpenMapTiles schema, the same schema the style's layers
// read (src/map/style.ts), from Geofabrik's OpenStreetMap extract with Planetiler. Needs Java 21 and the network; takes a
// few minutes and about 4 GB of memory. The archive (about 90 MB) stays out of git, in assets-src/tiles/.
//   node tools/tiles-basemap.mjs           build assets-src/tiles/<BASEMAP_ARCHIVE>.pmtiles
//   node tools/tiles-basemap.mjs --upload  then put it in the bucket of every deployment: staging, then production
// A new extract is a new archive: set BASEMAP_ARCHIVE in src/shared/tiles.ts to a new name (the day's date) first. Tiles
// are cached as immutable under the archive's name, so an archive is never overwritten in place. Upload before the
// deploy that names it: until its archive is in the bucket, a deployment's map has no basemap.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { assets, repo } from "./paths.mjs"

const PLANETILER = "0.10.2"
const shared = readFileSync(path.join(repo, "src/shared/tiles.ts"), "utf8")
const archive = /BASEMAP_ARCHIVE = "([^"]+)"/.exec(shared)[1]
const maxzoom = /BASEMAP_MAXZOOM = (\d+)/.exec(shared)[1]
const bounds = /TILE_BOUNDS = \[([^\]]+)\]/.exec(shared)[1].replace(/\s/g, "")
const dir = path.join(assets, "tiles")
const out = path.join(dir, `${archive}.pmtiles`)
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts })

if (process.argv.includes("--upload")) {
  if (!existsSync(out)) throw new Error(`${out} isn't built yet`)
  // The buckets are in the EU, like every bucket of the site (scripts/release-platform.mjs).
  for (const bucket of ["makom-staging-tiles", "makom-tiles"])
    run(
      "npx",
      ["wrangler", "r2", "object", "put", `${bucket}/basemap/${archive}.pmtiles`, `--file=${out}`, "--jurisdiction=eu", "--remote"],
      { cwd: repo },
    )
  process.exit(0)
}

mkdirSync(dir, { recursive: true })
const jar = path.join(dir, `planetiler-${PLANETILER}.jar`)
if (!existsSync(jar))
  run("curl", ["-fL", "-o", jar, `https://github.com/onthegomap/planetiler/releases/download/v${PLANETILER}/planetiler.jar`])
run(
  "java",
  [
    "-Xmx4g",
    "-jar",
    jar,
    "--download",
    // Geofabrik's extract; its sea and lakes come from the coastline and Natural Earth files --download fetches.
    "--area=israel-and-palestine",
    `--bounds=${bounds}`,
    `--maxzoom=${maxzoom}`,
    // The style reads name:he only; the rest are left out to keep the archive small.
    "--languages=he",
    `--output=${out}`,
    "--force",
  ],
  { cwd: dir },
)
console.log(`${out}: ${(statSync(out).size / 1e6).toFixed(1)} MB`)
