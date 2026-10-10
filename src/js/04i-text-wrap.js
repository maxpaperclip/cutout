/* =====================================================================
   Text wrapping around shapes (no DOM except paper.js; unit tested)
   A shape with o.wrap on (any kind but text) is something that a text with a box (area text, o.bw) flows around, whatever is
   stacked above or below what. Each row of the text asks "where in this row is the text box free?" and fills those
   stretches one after the other (textLayout, 04f-text-layout.js).
   The shape's real outline is used, not its box: a circle leaves the corners free, a star flows into its notches' sides. For
   a row, the outline is cut to the row's band of height; whatever of it is inside the band blocks everything from its leftmost
   to its rightmost point (a shape with a hole, or a C, is not flowed into: the text stays out of the whole span). o.wgap is the
   gap kept around it (WRAP_GAP when not set), applied as a square: the band is made taller by it and the span wider.
   Everything is in the text's own box coordinates (0,0 = top-left of its box), so a turned or mirrored text, and a turned
   or mirrored shape, work the same way. wrapSyncAll keeps the texts up to date when a shape moves, turns or changes.
   ===================================================================== */
const WRAP_GAP = 8, WRAP_GAP_MAX = 200;
const wrapGapOf = o => o.wgap >= 0 ? Math.min(+o.wgap, WRAP_GAP_MAX) : WRAP_GAP;
// Whether a shape can be wrapped around (a text cannot: a text that wraps around a text that wraps around it has no end)
const canWrapAround = o => !!o && o.kind !== 'text';

// The outline of a shape as closed polygons in its own box coordinates ([[x, y], ...] each), kept for the next time
const wrapPolyCache = new Map();
function wrapLocalPolys(o) {
  const box = [[[0, 0], [o.w, 0], [o.w, o.h], [0, o.h]]];
  if (o.kind === 'rect' || o.kind === 'image') return box;
  if (o.kind === 'ellipse') {
    const pts = [], n = 72;
    for (let i = 0; i < n; i++) { const a = i * 2 * Math.PI / n; pts.push([o.w / 2 + Math.cos(a) * o.w / 2, o.h / 2 + Math.sin(a) * o.h / 2]); }
    return [pts];
  }
  if (typeof o.d !== 'string' || !o.d) return box;
  const key = o.d;
  let polys = wrapPolyCache.get(key);
  if (polys) return polys;
  polys = [];
  try {
    const item = new paper.CompoundPath({ pathData: o.d, insert: false });
    item.children.forEach(c => {
      c.flatten(0.4);
      const pts = c.segments.map(sg => [sg.point.x, sg.point.y]);
      if (pts.length) polys.push(pts);
    });
  } catch (e) { polys = []; }
  if (!polys.length) polys = box;
  wrapPolyCache.set(key, polys);
  if (wrapPolyCache.size > 120) wrapPolyCache.delete(wrapPolyCache.keys().next().value);
  return polys;
}

// The shapes a text (with a box) flows around: [{ polys (in the text's box coordinates), pad, b: { x0, y0, x1, y1 } }]
function wrapObstacles(t) {
  if (!(t.bw > 0) || typeof doc === 'undefined' || !doc || !doc.objects) return [];
  const out = [];
  doc.objects.forEach(o => {
    if (!o.wrap || !canWrapAround(o) || o.id === t.id || isHidden(o)) return;
    const pad = wrapGapOf(o) + (o.stroke && o.stroke !== 'none' && !hasPixels(o) ? (o.sw || 0) / 2 : 0);
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const polys = wrapLocalPolys(o).map(poly => poly.map(([u, v]) => {
      const lx = o.fx ? o.w - u : u, ly = o.fy ? o.h - v : v;
      const r = rotPt(o.x + lx, o.y + ly, cx, cy, o.rot || 0), q = worldToBox(t, r.x, r.y);
      if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1];
      return q;
    }));
    if (x1 < -pad || x0 > t.bw + pad || y1 < -pad) return;   // (left of, right of, or above the text's box: no row of it can be touched)
    out.push({ polys, pad, b: { x0, y0, x1, y1 } });
  });
  return out;
}

// What a row from y0 to y1 loses to the shapes: sorted, joined stretches [x0, x1] of the box it cannot use
function wrapBlocked(obs, y0, y1) {
  const spans = [];
  obs.forEach(ob => {
    const Y0 = y0 - ob.pad, Y1 = y1 + ob.pad;
    if (Y1 <= ob.b.y0 || Y0 >= ob.b.y1) return;   // (a band that only touches the shape is not blocked)
    let lo = Infinity, hi = -Infinity;
    const take = x => { if (x < lo) lo = x; if (x > hi) hi = x; };
    ob.polys.forEach(poly => {
      for (let i = 0, n = poly.length; i < n; i++) {
        const p = poly[i], q = poly[(i + 1) % n];
        if (p[1] >= Y0 && p[1] <= Y1) take(p[0]);   // (a corner inside the band)
        [Y0, Y1].forEach(yy => { if ((p[1] - yy) * (q[1] - yy) < 0) take(p[0] + (yy - p[1]) / (q[1] - p[1]) * (q[0] - p[0])); });   // (an edge crossing the top or bottom of the band)
      }
    });
    if (lo <= hi) spans.push([lo - ob.pad, hi + ob.pad]);
  });
  spans.sort((a, b) => a[0] - b[0]);
  const out = [];
  spans.forEach(sp => { const l = out[out.length - 1]; if (l && sp[0] <= l[1]) l[1] = Math.max(l[1], sp[1]); else out.push(sp.slice()); });
  return out;
}
// The stretches of a box bw wide that are free for a row from y0 to y1: [[x0, x1], ...] left to right, none narrower than minW
function wrapFree(obs, bw, y0, y1, minW) {
  const blocked = wrapBlocked(obs, y0, y1);
  if (!blocked.length) return [[0, bw]];
  const out = [];
  let x = 0;
  blocked.forEach(([a, b]) => {
    if (b <= x) return;
    if (a >= bw) return;
    if (a > x && a - x >= minW) out.push([x, a]);
    x = Math.max(x, b);
  });
  if (bw - x >= minW && x < bw) out.push([x, bw]);
  return out;
}

// A short string for the shapes a text flows around, to tell one layout from another (in the cache of layouts)
function wrapSig(obs) {
  if (!obs.length) return '';
  let h = 2166136261;
  const mix = v => { h = Math.imul(h ^ (Math.round(v * 10) | 0), 16777619) >>> 0; };
  obs.forEach(ob => { mix(ob.pad); ob.polys.forEach(poly => { mix(poly.length); poly.forEach(p => { mix(p[0]); mix(p[1]); }); }); });
  return h.toString(36) + ':' + obs.length;
}

// A text is laid out for the shapes around at the time. This remembers for which, so a text can be laid out again when they change
const wrapSigOf = new WeakMap();
function wrapSyncAll() {
  if (typeof doc === 'undefined' || !doc || !doc.objects) return false;
  const anyWrap = doc.objects.some(o => o.wrap);
  let changed = false;
  doc.objects.forEach(t => {
    if (t.kind !== 'text' || !(t.bw > 0)) return;
    const used = wrapSigOf.get(t) || '';
    if (!anyWrap && !used) return;
    const now = wrapSig(wrapObstacles(t));
    if (now !== used) { refresh(t); changed = true; }
  });
  return changed;
}
