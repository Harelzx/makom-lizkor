// Reproduce the bundled navigation boundaries from pinned licensed sources. This is not a build-time download.
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"

const file = process.argv[2]
if (!file) throw new Error("Pass the saved geoBoundaries ISR ADM2 GeoJSON file")
const bytes = readFileSync(file)
const sha256 = createHash("sha256").update(bytes).digest("hex")
if (sha256 !== "32079c9747279aa5f7a060b4cce241814ea46c45ae4081f3b713c0ddf7b05100")
  throw new Error("Boundary source differs from the reviewed snapshot; review its provenance before updating")
const source = JSON.parse(bytes)
const territoryBytes = readFileSync(process.argv[3])
const territoryHash = createHash("sha256").update(territoryBytes).digest("hex")
if (territoryHash !== "2f065583a8be795533893fd4c62fed765959b47db2cf01e696cc795cc6c56b0a")
  throw new Error("Supplementary boundary differs from the pinned snapshot")
const westBank = JSON.parse(territoryBytes).features.find((f) => f.properties.shapeName === "West Bank")
if (!westBank) throw new Error("West Bank polygon absent")
const round = (value) => (Array.isArray(value) ? value.map(round) : Math.round(value * 100_000) / 100_000)
const data = {
  source: {
    publisher: "geoBoundaries / Wikimedia Commons",
    boundaryID: "ISR-ADM2-584046",
    year: 2021,
    license: "CC0-1.0",
    url: "https://github.com/wmgeolab/geoBoundaries/blob/9469f09/releaseData/gbOpen/ISR/ADM2/geoBoundaries-ISR-ADM2.geojson",
    sha256,
  },
  supplementarySource: {
    publisher: "geoBoundaries / Open Data Watch",
    boundaryID: "PSE-ADM1-83478781",
    year: 2021,
    license: "CC-BY-4.0",
    url: "https://github.com/wmgeolab/geoBoundaries/blob/9469f09/releaseData/gbOpen/PSE/ADM1/geoBoundaries-PSE-ADM1_simplified.geojson",
    sha256: territoryHash,
    changes: "Only the West Bank feature, from the publisher's simplified file; coordinates rounded to five decimals",
  },
  features: [...source.features, westBank].map((f) => ({
    name: f.properties.shapeName,
    geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
  })),
}
writeFileSync(new URL("../src/data/region-boundaries.json", import.meta.url), JSON.stringify(data) + "\n")
console.log(`Prepared ${data.features.length} navigation boundary features; rounded to five decimals, no additional simplification`)
