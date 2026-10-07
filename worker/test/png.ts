// Reads back what a share image actually shows, for the tests that check its photo was drawn (P7-OG-1).

/** A PNG's pixels (8-bit RGB or RGBA, non-interlaced), as resvg writes them. */
export async function pixels(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let at = 8
  let width = 0
  let height = 0
  let channels = 0
  const idat: Uint8Array[] = []
  while (at < png.length) {
    const len = view.getUint32(at)
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8))
    const data = png.subarray(at + 8, at + 8 + len)
    if (type === "IHDR") {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      channels = { 2: 3, 6: 4 }[data[9]]!
    }
    if (type === "IDAT") idat.push(data)
    at += 12 + len
  }
  const raw = new Uint8Array(await new Response(new Blob(idat).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer())
  const stride = width * channels
  const out = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]
      const a = x >= channels ? out[y * stride + x - channels] : 0
      const up = y ? out[(y - 1) * stride + x] : 0
      const c = y && x >= channels ? out[(y - 1) * stride + x - channels] : 0
      const p = a + up - c
      const pred = [
        0,
        a,
        up,
        (a + up) >> 1,
        Math.abs(p - a) <= Math.abs(p - up) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - up) <= Math.abs(p - c) ? up : c,
      ][filter]
      out[y * stride + x] = (v + pred) & 0xff
    }
  }
  return (x: number, y: number) => Array.from(out.subarray(y * stride + x * channels, y * stride + x * channels + 3))
}
