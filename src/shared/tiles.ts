/**
 * The map's own tiles, shared by the style (src/map/style.ts) and the Worker that serves them (worker/routes/tiles.ts).
 * Nothing the map draws comes from another host: an outside tile server with no agreement could throttle or vanish, and
 * the map is the site.
 *
 * The basemap is one PMTiles archive of Israel in the OpenMapTiles schema (tools/tiles-basemap.sh), in the TILES bucket
 * under BASEMAP_ARCHIVE, read tile by tile by the Worker. Its name is in every tile's address, so a tile is cached as
 * immutable: a new extract is uploaded under a new name and this constant moves to it, never overwritten in place.
 * The terrain is small enough to ship as static files (public/terrain/, tools/tiles-terrain.py).
 */
export const BASEMAP_ARCHIVE = "israel-openmaptiles-20261013"
export const BASEMAP_MAXZOOM = 14
export const TERRAIN_VERSION = "1"
export const TERRAIN_MAXZOOM = 8
/** The camera's maxBounds (src/map/controller.ts): west, south, east, north. No tile outside them is ever asked for. */
export const TILE_BOUNDS = [33.6, 29.2, 36.4, 33.6] as [number, number, number, number]

/** The archive's key in the bucket. */
export const basemapKey = (archive: string) => `basemap/${archive}.pmtiles`
