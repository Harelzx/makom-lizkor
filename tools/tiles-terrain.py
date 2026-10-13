# Writes the map's terrain into public/terrain/<version>/: the Terrarium elevation tiles (Mapzen / AWS Open Data) over
# the camera's bounds, zoom 0 to 8, as static files, so the relief no longer depends on AWS answering. Re-runnable:
#   python3 tools/tiles-terrain.py
# 34 tiles, about 3 MB. The relief is shaded from coarse tiles on purpose (style.ts, maxzoom 8): past that the western
# Negev is flat and the hillshade reads the same. The bounds are the controller's maxBounds; the style gives the source
# the same bounds, so a tile outside them is never asked for. Bump TERRAIN in src/shared/tiles.ts to change them, since
# the files are cached as immutable.
import math, os, re, subprocess, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=HERE, capture_output=True, text=True, check=True).stdout.strip()
SHARED = open(os.path.join(REPO, "src", "shared", "tiles.ts"), encoding="utf8").read()
VERSION = re.search(r'TERRAIN_VERSION = "([^"]+)"', SHARED).group(1)
WEST, SOUTH, EAST, NORTH = (float(v) for v in re.search(r"TILE_BOUNDS = \[([^\]]+)\]", SHARED).group(1).split(","))
MAXZOOM = int(re.search(r"TERRAIN_MAXZOOM = (\d+)", SHARED).group(1))
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
OUT = os.path.join(REPO, "public", "terrain", VERSION)


def tile(lon, lat, z):
    n = 2**z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return min(x, n - 1), min(y, n - 1)


count = size = 0
for z in range(MAXZOOM + 1):
    x0, y0 = tile(WEST, NORTH, z)
    x1, y1 = tile(EAST, SOUTH, z)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            with urllib.request.urlopen(URL.format(z=z, x=x, y=y), timeout=30) as r:
                data = r.read()
            assert data[:8] == b"\x89PNG\r\n\x1a\n", f"{z}/{x}/{y} is not a PNG"
            path = os.path.join(OUT, str(z), str(x), f"{y}.png")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(data)
            count += 1
            size += len(data)
print(f"public/terrain/{VERSION}: {count} tiles, {size / 1e6:.1f} MB")
