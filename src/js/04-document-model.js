/* =====================================================================
   Document model
   Every object has a box (x, y, w, h) plus rot (degrees, about the center).
   rect / ellipse: drawn natively.   polygon / text / path: an SVG path `d`
   in local coordinates (0,0 = top-left of the box).   line: two endpoints.
   ===================================================================== */
const blankDoc = () => ({ w: 800, h: 600, bg: '#ffffff', nextId: 1, objects: [] });
let doc = blankDoc();
const S = {
  tool: 'select', sel: new Set(), snap: true, showGrid: true, grid: 20, clip: null, pasteN: 0,
  style: { fill: '#3b3bf5', grad: null, stroke: 'none', sw: 2, join: 'miter', dash: 'solid' }
};
const view = { x: 0, y: 0, z: 1 };

// Photo limits. Change these to suit the devices your students use.
const LIMITS = {
  fileBytes: 15 * 1024 * 1024,   // largest file accepted for import
  srcPixels: 50e6,               // largest picture accepted, in pixels (width x height); a small file can still be huge once opened
  edge: 1600,                    // photos are shrunk so the longest side is at most this many pixels
  storedBytes: 3 * 1024 * 1024,  // a shrunk photo is squeezed further if it is still bigger than this
  photos: 12                     // most different photos in one drawing
};
// Photos live here once; the drawing and the undo history only point at them by id.
const images = new Map();        // id -> { id, blob, dataUrl, w, h, mime, bytes, name, stored }
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '').slice(0, 20) : Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
function docImageIds(d) {
  const s = new Set();
  d.objects.forEach(o => { if (o.kind === 'image' && o.img) s.add(o.img); if (o.pic && o.pic.id) s.add(o.pic.id); });
  return s;
}
// A shape (or text) whose fill is a photo
const hasPic = o => !!(o.pic && o.kind !== 'line' && o.kind !== 'image' && images.has(o.pic.id));
// A shape (or text) whose fill is a gradient (see "gradient fills" below)
const hasGrad = o => !!(o && o.grad && o.kind !== 'line' && o.kind !== 'image');
const byId = id => doc.objects.find(o => o.id === id);
const selObjs = () => doc.objects.filter(o => S.sel.has(o.id));
const one = () => { const s = selObjs(); return s.length === 1 ? s[0] : null; };

const KIND_LABEL = { image: 'Photo', rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', line: 'Line', text: 'Text', path: 'Shape' };
function labelOf(o) {
  if (o.name) return o.name;
  if (o.kind === 'text') return (o.text || '').split('\n')[0].slice(0, 26) || 'Text';
  if (o.kind === 'polygon' && o.star) return 'Star';
  return KIND_LABEL[o.kind] || 'Object';
}
const iconFor = o => o.kind === 'polygon' ? (o.star ? 'star' : 'polygon') : (o.kind !== 'line' && o.kind !== 'image' && o.pic ? 'image' : o.kind);

/* ---------- gradient fills ----------
   o.grad = { type: 'linear' | 'radial', stops: [{ at, c, a }, ...],
              x1, y1, x2, y2         (linear: the gradient line's two ends)
              cx, cy, r, [fx, fy] }  (radial: center, radius, optional focal point)
   Every position is a fraction of the object's box (0,0 = top-left, 1,1 = bottom-right), so
   resizing, flipping and turning the object carry the gradient along with no extra work.
   A radial radius of 0.5 reaches the box edges; on a wide box the circle stretches into an ellipse.
   o.fill stays a plain color (the first stop) so older versions of Cutout, which drop o.grad when
   they open a drawing, still show a sensible solid color. */
const GRAD_TYPES = ['linear', 'radial'];
const GRAD_MAX_STOPS = 8;
const GRAD_DEFAULT_FROM = '#3b3bf5';
function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}
// A partner color for a new gradient: the same color, turned around the color wheel.
// Greys have no hue to turn, so they fade toward a lighter or darker grey instead.
function shiftHue(hex, deg) {
  const [h, s, l] = hexToHsl(hex);
  if (s < 0.08) return hslToHex(0, 0, l > 0.5 ? l - 0.45 : l + 0.45);
  return hslToHex(((h + deg) % 360 + 360) % 360, s, l);
}
const isHex6 = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
function normHex(c) {
  if (typeof c !== 'string') return null;
  if (isHex6(c)) return c.toLowerCase();
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  return m ? ('#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toLowerCase() : null;
}
// A new gradient going from one color to another. Colors default to the given fill and a partner for it.
function makeGrad(type, from, to) {
  const c0 = normHex(from) || GRAD_DEFAULT_FROM, c1 = normHex(to) || shiftHue(c0, 60);
  const stops = [{ at: 0, c: c0, a: 1 }, { at: 1, c: c1, a: 1 }];
  return type === 'radial' ? { type: 'radial', stops, cx: 0.5, cy: 0.5, r: 0.5 }
    : { type: 'linear', stops, x1: 0, y1: 0.5, x2: 1, y2: 0.5 };
}
const cloneGrad = g => g ? JSON.parse(JSON.stringify(g)) : null;
// Keep the plain fill color in step with the gradient (it is what older versions show)
function syncGradFill(o) { if (hasGrad(o)) o.fill = o.grad.stops[0].c; }
// Direction of a linear gradient in degrees, measured on the page (0 = left to right, 90 = top to bottom)
function gradAngle(o) {
  const g = o.grad;
  return normDeg(Math.atan2((g.y2 - g.y1) * o.h, (g.x2 - g.x1) * o.w) / D2R);
}
// Point a linear gradient in a direction. The line runs through the box center and is just long
// enough to reach the far corners, so the first and last colors land exactly on the box edges.
function setGradAngle(o, deg) {
  const g = o.grad, a = deg * D2R, c = Math.cos(a), s = Math.sin(a);
  const w = Math.max(o.w, 1e-6), h = Math.max(o.h, 1e-6), half = (w * Math.abs(c) + h * Math.abs(s)) / 2;
  const r5 = v => rnd(v, 5) + 0;   // + 0 turns -0 into 0
  g.x1 = r5(0.5 - half * c / w); g.y1 = r5(0.5 - half * s / h);
  g.x2 = r5(0.5 + half * c / w); g.y2 = r5(0.5 + half * s / h);
}
/* Editing the colors along a gradient. Stops are always kept in order from start (at 0) to end
   (at 1). Each helper returns the index of the stop it touched, so the editor can keep it selected. */
const GRAD_MIN_STOPS = 2;
const sortStops = g => { g.stops.sort((p, q) => p.at - q.at); };
// The color (and opacity) the gradient shows at a position, blending between the stops on either side
function gradColorAt(stops, t) {
  if (t <= stops[0].at) return { c: stops[0].c, a: stops[0].a };
  const last = stops[stops.length - 1];
  if (t >= last.at) return { c: last.c, a: last.a };
  let i = 1;
  while (stops[i].at < t) i++;
  const p = stops[i - 1], q = stops[i], k = q.at > p.at ? (t - p.at) / (q.at - p.at) : 0;
  const ch = (h, s) => parseInt(h.slice(s, s + 2), 16);
  const mix = s => Math.round(ch(p.c, s) + (ch(q.c, s) - ch(p.c, s)) * k).toString(16).padStart(2, '0');
  return { c: '#' + mix(1) + mix(3) + mix(5), a: rnd(p.a + (q.a - p.a) * k, 3) };
}
// Add a color at a position, matching what the gradient already shows there, so adding a stop
// never changes how the shape looks until the new color is edited. Returns -1 when full.
function addGradStop(g, at) {
  if (g.stops.length >= GRAD_MAX_STOPS) return -1;
  at = rnd(clamp(at, 0, 1), 4);
  const s = Object.assign({ at }, gradColorAt(g.stops, at));
  g.stops.push(s); sortStops(g);
  return g.stops.indexOf(s);
}
// Remove a color. A gradient always keeps at least two. Returns the index to select next, or -1.
function removeGradStop(g, i) {
  if (g.stops.length <= GRAD_MIN_STOPS || i < 0 || i >= g.stops.length) return -1;
  g.stops.splice(i, 1);
  return Math.min(i, g.stops.length - 1);
}
// Slide a color along the gradient. It can pass its neighbours; returns its new index.
function moveGradStop(g, i, at) {
  const s = g.stops[i]; if (!s) return -1;
  s.at = rnd(clamp(at, 0, 1), 4); sortStops(g);
  return g.stops.indexOf(s);
}
// Swap the gradient's colors end for end
function reverseGrad(g) { g.stops = g.stops.map(s => ({ at: rnd(1 - s.at, 5), c: s.c, a: s.a })).reverse(); }
// Check a gradient read from a file. Returns a clean copy, or null when it can't be used.
function sanitizeGrad(r) {
  if (!r || typeof r !== 'object' || GRAD_TYPES.indexOf(r.type) < 0 || !Array.isArray(r.stops)) return null;
  const num = (v, def, a, b) => { v = +v; return Number.isFinite(v) ? clamp(v, a, b) : def; };
  const stops = r.stops.slice(0, GRAD_MAX_STOPS).map(s => {
    const c = s && normHex(s.c);
    return c ? { at: num(s.at, 0, 0, 1), c, a: num(s.a, 1, 0, 1) } : null;
  }).filter(Boolean).sort((p, q) => p.at - q.at);
  if (stops.length < 2) return null;
  const P = 1e3;   // gradient ends may sit well outside the box, but not absurdly far
  if (r.type === 'linear') return { type: 'linear', stops, x1: num(r.x1, 0, -P, P), y1: num(r.y1, 0.5, -P, P), x2: num(r.x2, 1, -P, P), y2: num(r.y2, 0.5, -P, P) };
  const g = { type: 'radial', stops, cx: num(r.cx, 0.5, -P, P), cy: num(r.cy, 0.5, -P, P), r: num(r.r, 0.5, 0.001, P) };
  if (r.fx !== undefined && r.fy !== undefined) { g.fx = num(r.fx, g.cx, -P, P); g.fy = num(r.fy, g.cy, -P, P); }
  return g;
}

/* ---------- geometry builders ---------- */
function buildText(o) {
  const font = fontOf(o.font), size = o.size, scale = size / font.unitsPerEm;
  const asc = font.ascender * scale, desc = -font.descender * scale;
  const lineH = size * o.lh, lines = String(o.text).split('\n');
  const opts = { kerning: true, letterSpacing: o.ls || 0 };
  const widths = lines.map(l => l ? font.getAdvanceWidth(l, size, opts) : 0);
  const W = Math.max(size * 0.4, ...widths);
  let d = '';
  lines.forEach((l, i) => {
    if (!l) return;
    const x = o.align === 'center' ? (W - widths[i]) / 2 : o.align === 'right' ? W - widths[i] : 0;
    const y = i * lineH + (lineH - (asc + desc)) / 2 + asc;
    d += font.getPath(l, x, y, size, opts).toPathData(2);
  });
  return { d, w: W, h: lineH * lines.length };
}
function buildPolygon(o) {
  const n = clamp(Math.round(o.sides || 5), 3, 24), star = !!o.star, inner = clamp(o.inner || 0.45, 0.1, 0.95);
  const total = star ? n * 2 : n, pts = [];
  for (let i = 0; i < total; i++) {
    const a = -Math.PI / 2 + i * 2 * Math.PI / total, r = star && i % 2 ? inner : 1;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  pts.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
  const sx = o.w / (x1 - x0), sy = o.h / (y1 - y0);
  return 'M' + pts.map(p => rnd((p[0] - x0) * sx, 3) + ' ' + rnd((p[1] - y0) * sy, 3)).join('L') + 'Z';
}
const natCache = new Map();
function scaledPathD(nat, w, h) {
  const sx = nat.w > 1e-6 ? w / nat.w : 1, sy = nat.h > 1e-6 ? h / nat.h : 1;
  if (Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9) return nat.d;
  let base = natCache.get(nat.d);
  if (!base) {
    base = new paper.CompoundPath({ pathData: nat.d, insert: false });
    natCache.set(nat.d, base);
    if (natCache.size > 24) natCache.delete(natCache.keys().next().value);
  }
  const c = base.clone({ insert: false });
  c.scale(sx, sy, new paper.Point(0, 0));
  return c.pathData;
}
function syncLineBox(o) {
  o.x = Math.min(o.x1, o.x2); o.y = Math.min(o.y1, o.y2);
  o.w = Math.abs(o.x2 - o.x1); o.h = Math.abs(o.y2 - o.y1); o.rot = 0;
}
// Rebuild derived geometry after a parameter changed
function refresh(o) {
  if (o.kind === 'text') { const g = buildText(o); o.d = g.d; o.w = g.w; o.h = g.h; }
  else if (o.kind === 'polygon') o.d = buildPolygon(o);
  else if (o.kind === 'path') o.d = scaledPathD(o.nat, o.w, o.h);
  else if (o.kind === 'line') syncLineBox(o);
}
function newShape(kind, props) {
  const st = S.style;
  const o = Object.assign({
    id: doc.nextId++, kind, name: '', x: 0, y: 0, w: 100, h: 100, rot: 0,
    fill: st.fill, stroke: st.stroke, sw: st.sw, opacity: 1, join: st.join, dash: st.dash, hidden: false, locked: false
  }, props || {});
  const given = k => props && props[k] !== undefined;
  // New shapes pick up the last gradient used, just as they pick up the last fill color.
  // Each shape gets its own copy, so editing one shape's gradient never changes another's.
  if (st.grad && !given('fill') && !given('grad') && kind !== 'line' && kind !== 'text' && kind !== 'image') { o.grad = cloneGrad(st.grad); o.fill = o.grad.stops[0].c; }
  if (kind === 'rect' && o.r === undefined) o.r = 0;
  if (kind === 'polygon') { o.sides = o.sides || 6; o.star = !!o.star; o.inner = o.inner || 0.45; }
  if (kind === 'line') {
    if (!given('fill')) o.fill = 'none';
    if (!given('stroke')) o.stroke = st.stroke === 'none' ? '#151936' : st.stroke;
    if (!given('sw')) o.sw = Math.max(st.sw, 3);
    o.x1 = o.x1 || 0; o.y1 = o.y1 || 0; o.x2 = o.x2 || 0; o.y2 = o.y2 || 0;
  }
  if (kind === 'text') {
    o.text = o.text !== undefined ? o.text : 'Text'; o.font = o.font || DEFAULT_FONT; o.size = o.size || 64;
    o.align = o.align || 'left'; o.lh = o.lh || 1.2; o.ls = o.ls || 0;
    if (!given('fill')) o.fill = '#151936';
    if (!given('stroke')) o.stroke = 'none';
  }
  refresh(o);
  return o;
}

/* ---------- bounds ---------- */
function centerOf(o) { return { x: o.x + o.w / 2, y: o.y + o.h / 2 }; }
function aabb(o) {
  if (!o.rot) return { x: o.x, y: o.y, w: o.w, h: o.h };
  const c = centerOf(o);
  const pts = [[o.x, o.y], [o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h]].map(p => rotPt(p[0], p[1], c.x, c.y, o.rot));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}
function unionBox(list) {
  let x0 = 1e12, y0 = 1e12, x1 = -1e12, y1 = -1e12;
  list.forEach(o => { const b = aabb(o); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function moveBy(o, dx, dy) {
  o.x += dx; o.y += dy;
  if (o.kind === 'line') { o.x1 += dx; o.x2 += dx; o.y1 += dy; o.y2 += dy; }
}

