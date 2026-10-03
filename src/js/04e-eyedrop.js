/* =====================================================================
   Eyedropper (the sums behind the color picker's eyedropper)
   The eyedropper reads colors from a picture of what is on screen: the whole drawing, all layers,
   blend modes and opacity included, drawn once at the size of the canvas so that one pixel of the
   picture is one pixel on screen. These are the pure parts: which part of the page to draw, and how
   to turn the pixels under the pointer into one color. The tool itself is in 09e-eyedropper.js.
   ===================================================================== */
const DROP = { maxPixels: 8e6 };   // never draw a bigger picture than this (a huge, high-resolution screen draws it smaller)

// The part of the page the canvas shows, and the size of the picture to draw it at.
// s: the canvas size on screen { w, h }; v: the view { x, y, z } (page to screen: screen = page * z + x, y).
// k is how many picture pixels there are per screen pixel (1 unless the picture had to be made smaller).
function dropRegion(s, v, maxPixels) {
  const w = Math.max(1, Math.round(s.w)), h = Math.max(1, Math.round(s.h));
  const k = Math.min(1, Math.sqrt((maxPixels || DROP.maxPixels) / (w * h)));
  return {
    box: { x: -v.x / v.z, y: -v.y / v.z, w: s.w / v.z, h: s.h / v.z },
    W: Math.max(1, Math.round(w * k)), H: Math.max(1, Math.round(h * k)), k
  };
}
// The picture pixel under a point on the canvas (screen pixels from the canvas's top left)
const dropPixel = (region, sx, sy) => ({
  x: clamp(Math.floor(sx * region.k), 0, region.W - 1), y: clamp(Math.floor(sy * region.k), 0, region.H - 1)
});
// The color at pixel (px, py) of RGBA data, w x h pixels: that pixel (n = 1), or the average of it and
// its eight neighbours (n = 3; at an edge, the ones that exist). Pixels count in proportion to how
// opaque they are, so a clear neighbour does not wash the color out. Returns { r, g, b, a }, a from 0 to 1;
// a is 0 when there is nothing there.
function dropAverage(data, w, h, px, py, n) {
  const r = n >= 3 ? 1 : 0;
  let sr = 0, sg = 0, sb = 0, sa = 0, count = 0;
  for (let y = Math.max(0, py - r); y <= Math.min(h - 1, py + r); y++) {
    for (let x = Math.max(0, px - r); x <= Math.min(w - 1, px + r); x++) {
      const i = (y * w + x) * 4, a = data[i + 3];
      sr += data[i] * a; sg += data[i + 1] * a; sb += data[i + 2] * a; sa += a; count++;
    }
  }
  if (!count || !sa) return { r: 0, g: 0, b: 0, a: 0 };
  return { r: Math.round(sr / sa), g: Math.round(sg / sa), b: Math.round(sb / sa), a: sa / (count * 255) };
}
const dropHex = c => '#' + [c.r, c.g, c.b].map(v => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('');
