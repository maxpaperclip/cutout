/* =====================================================================
   Document model
   Every object has a box (x, y, w, h) plus rot (degrees, about the center).
   rect / ellipse: drawn natively.   polygon / text / path: an SVG path `d`
   in local coordinates (0,0 = top-left of the box).   line: two endpoints.
   ===================================================================== */
const blankDoc = () => ({ w: 800, h: 600, bg: '#ffffff', nextId: 1, objects: [], groups: [] });   // groups: see 04b-groups.js
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
const images = new Map();        // id -> { id, blob, dataUrl, w, h, mime, bytes, name, stored, mask }   (mask: an erase mask, see 04d-erase.js)
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '').slice(0, 20) : Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
// Every stored picture the drawing needs: photos, photo fills, and the erase masks kept beside them
function docImageIds(d) {
  const s = new Set();
  d.objects.forEach(o => { if (hasPixels(o) && o.img) s.add(o.img); if (o.pic && o.pic.id) s.add(o.pic.id); if (o.erase) s.add(o.erase); });
  return s;
}
// Only the photos: erase masks and paint layers are bookkeeping, so they don't count toward LIMITS.photos
function docPhotoIds(d) {
  const s = docImageIds(d);
  d.objects.forEach(o => { if (o.erase) s.delete(o.erase); if (o.paint) s.delete(o.img); });
  return s;
}
// A shape (or text) whose fill is a photo
const hasPic = o => !!(o.pic && hasPaint(o) && images.has(o.pic.id));
// A shape (or text) whose fill is a gradient (see "gradient fills" below)
const hasGrad = o => !!(o && o.grad && hasPaint(o));
const byId = id => doc.objects.find(o => o.id === id);
const selObjs = () => doc.objects.filter(o => S.sel.has(o.id));
const one = () => { const s = selObjs(); return s.length === 1 ? s[0] : null; };

/* What each kind of object is and can do. Code asks these questions (through the helpers below)
   instead of naming kinds, so a new kind (paint layers, say) is one entry here.
     pixels:     drawn from a stored picture (see images); has no fill, outline or gradient.
                 A photo, or a paint layer (o.paint: true), whose picture the Brush tool repaints (see 04d-erase.js)
     keepsRatio: resizing keeps its proportions (text grows by font size, pictures don't stretch)
     plain:      can become a plain shape (Convert to plain shape, Edit points) */
const KIND_INFO = {
  rect:    { label: 'Rectangle', plain: true },
  ellipse: { label: 'Ellipse', plain: true },
  polygon: { label: 'Polygon', plain: true },
  text:    { label: 'Text', plain: true, keepsRatio: true },
  path:    { label: 'Shape' },
  image:   { label: 'Photo', pixels: true, keepsRatio: true }
};
const kindInfo = o => (o && KIND_INFO[o.kind]) || {};
const hasPixels = o => !!kindInfo(o).pixels;      // a photo (no fill, outline or gradient of its own)
const hasPaint = o => !!o && !hasPixels(o);       // has a fill, an outline, and maybe a gradient
const keepsRatio = o => !!kindInfo(o).keepsRatio;
function labelOf(o) {
  if (o.name) return o.name;
  if (o.kind === 'text') { const t = (o.text || '').split('\n')[0].slice(0, 26); return t.trim() ? t : 'Text'; }   // (a first line of only spaces has no name of its own)
  if (o.kind === 'polygon' && o.star) return 'Star';
  if (isStraightLine(o)) return 'Line';
  return kindInfo(o).label || 'Object';
}
const iconFor = o => o.paint ? 'brush' : o.kind === 'polygon' ? (o.star ? 'star' : 'polygon') : hasPaint(o) && o.pic ? 'image' : isStraightLine(o) ? 'line' : o.kind;

/* ---------- blend modes and line ends ----------
   o.blend: how an object mixes with what's under it (absent = normal).
   o.cap:   how open outline ends and dash ends are drawn (absent = automatic: round for lines
            and drawn lines, flat for everything else, which is how FriendShaped has always drawn them). */
const BLENDS = [['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
  ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color dodge'], ['color-burn', 'Color burn'],
  ['hard-light', 'Hard light'], ['soft-light', 'Soft light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'],
  ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']];
const BLEND_IDS = BLENDS.map(b => b[0]);
const CAPS = ['butt', 'round', 'square'];
const blendOf = o => o.blend && o.blend !== 'normal' && BLEND_IDS.indexOf(o.blend) >= 0 ? o.blend : null;

/* ---------- shared field lists ----------
   STYLE_KEYS: how an object looks (kept when an object changes shape: Combine, Perspective, tilting back).
   KIND_PARAMS: the settings only one kind has; they go away when an object becomes a plain shape. */
const STYLE_KEYS = ['fill', 'grad', 'stroke', 'sw', 'opacity', 'join', 'dash', 'cap', 'blend'];
const KIND_PARAMS = { rect: ['r'], polygon: ['sides', 'star', 'inner'], text: ['text', 'font', 'size', 'align', 'lh', 'ls', 'runs', 'parts'] };
// Copy the listed settings from one object to another, removing any the source doesn't have.
// Gradients are copied, never shared, so editing one object's gradient can't change another's.
function copyKeys(from, to, keys) {
  keys.forEach(k => {
    if (from[k] === undefined) delete to[k];
    else to[k] = k === 'grad' ? cloneGrad(from[k]) : from[k];
  });
  return to;
}
// Turn an object into a plain shape with the given outline (box coordinates, already sized w x h)
function toPlainPath(o, d, w, h) {
  Object.keys(KIND_PARAMS).forEach(k => KIND_PARAMS[k].forEach(p => delete o[p]));
  o.kind = 'path'; o.w = w; o.h = h; o.nat = { d, w, h }; o.d = d;
  return o;
}
// A photo object showing the stored picture rec (see images); props sets or overrides anything
function makeImage(rec, props) {
  return Object.assign({ id: doc.nextId++, kind: 'image', img: rec.id, name: rec.name, x: 0, y: 0, w: rec.w, h: rec.h, rot: 0, opacity: 1, hidden: false, locked: false }, props);
}

/* ---------- gradient fills ----------
   o.grad = { type: 'linear' | 'radial', stops: [{ at, c, a }, ...],
              x1, y1, x2, y2         (linear: the gradient line's two ends)
              cx, cy, r, [fx, fy] }  (radial: center, radius, optional focal point)
   Every position is a fraction of the object's box (0,0 = top-left, 1,1 = bottom-right), so
   resizing, flipping and turning the object carry the gradient along with no extra work.
   A radial radius of 0.5 reaches the box edges; on a wide box the circle stretches into an ellipse.
   o.fill stays a plain color (the first stop) so older versions of FriendShaped, which drop o.grad when
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

/* ---------- freehand drawing (pencil) ----------
   The pencil records the pointer's path, then smooths it into a few curves with paper.js's
   simplify(). The result is an ordinary 'path' object, so it can be moved, resized, turned,
   recolored and edited like any other shape. A stroke that ends close to where it began is
   closed into a loop and filled; otherwise it stays an open line with no fill. */
const PENCIL = {
  tolerance: 2.5,   // how far (screen pixels) the smoothed curve may stray from the pointer's path
  closeGap: 14,     // end this close (screen pixels) to the start to close the loop
  minStep: 1.5      // ignore pointer moves smaller than this (screen pixels)
};
// points: page coordinates. z: the current zoom, so smoothing feels the same at any zoom.
// Returns { d, x, y, w, h, closed } with d in box coordinates, or null for a stroke too small to keep.
function pencilGeometry(points, z) {
  z = z || 1;
  const pts = [];
  points.forEach(p => { const q = pts[pts.length - 1]; if (!q || Math.hypot(p.x - q.x, p.y - q.y) * z >= PENCIL.minStep) pts.push({ x: p.x, y: p.y }); });
  if (pts.length < 2) return null;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (len * z < 4) return null;
  const a = pts[0], b = pts[pts.length - 1];
  const closed = pts.length > 3 && Math.hypot(b.x - a.x, b.y - a.y) * z <= PENCIL.closeGap && len * z > PENCIL.closeGap * 4;
  if (closed) pts.pop();   // the loop closes back to the first point by itself
  const path = new paper.Path({ segments: pts.map(p => [p.x, p.y]), insert: false });
  if (closed) path.closed = true;
  if (path.segments.length > 2) path.simplify(PENCIL.tolerance / z);
  const bn = path.bounds;
  path.translate(new paper.Point(-bn.x, -bn.y));
  return { d: path.pathData, x: bn.x, y: bn.y, w: Math.max(bn.width, 0.01), h: Math.max(bn.height, 0.01), closed };
}
// True when some part of a path doesn't join back up to its start (a pencil line, for example).
// Such paths have no inside, so they can't be combined or used as photo masks.
const openCache = new Map();
function pathIsOpen(d) {
  if (typeof d !== 'string' || !d) return false;
  let v = openCache.get(d);
  if (v === undefined) {
    v = d.split(/(?=[Mm])/).some(sub => /[^\s]/.test(sub) && !/[Zz]\s*$/.test(sub));
    openCache.set(d, v);
    if (openCache.size > 200) openCache.delete(openCache.keys().next().value);
  }
  return v;
}
const isOpenPath = o => o.kind === 'path' && pathIsOpen(o.d);

/* ---------- geometry builders ---------- */
// The outline of a text. Where each line goes comes from textLayout (04f-text-layout.js), which the caret and the selection use too.
// With letters in their own colors (o.runs) it also gives parts: the same outline in pieces, one per color ({ d, c }; no c = the text's own fill).
// A stretch of one face and size is drawn as one piece of text; where its color changes it is drawn in pieces that start
// where the layout says (that already includes the kerning), so coloring a letter never moves anything.
function buildText(o) {
  const lay = textLayout(o), opts = { kerning: true, letterSpacing: lay.ls };
  const colored = Array.isArray(o.runs) && o.runs.some(r => r.c !== undefined), by = new Map();
  let d = '';
  const add = (c, pd) => { d += pd; if (colored) by.set(c, (by.get(c) || '') + pd); };
  lay.lines.forEach(L => {
    L.segs.forEach(g => {
      if (g.b <= g.a) return;
      const pieces = [];
      if (colored) runSlices(o.runs, L.start + g.a, L.start + g.b).forEach(p => {
        const last = pieces[pieces.length - 1];
        if (last && last.c === p.st.c) last.b = p.b; else pieces.push({ a: p.a, b: p.b, c: p.st.c });
      });
      if (pieces.length < 2) { add(pieces.length ? pieces[0].c : undefined, g.font.getPath(L.text.slice(g.a, g.b), L.x + g.x, L.base, g.size, opts).toPathData(2)); return; }
      pieces.forEach(p => add(p.c, g.font.getPath(L.text.slice(p.a - L.start, p.b - L.start), L.x + L.m.xs[p.a - L.start], L.base, g.size, opts).toPathData(2)));
    });
  });
  const out = { d, w: lay.w, h: lay.h };
  if (colored) out.parts = Array.from(by, ([c, pd]) => c === undefined ? { d: pd } : { d: pd, c });
  return out;
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
// Rebuild derived geometry after a parameter changed
/* Derived outlines. o.d (the outline drawn for text, polygons and plain shapes) is always rebuilt
   from the object's own settings, so it is never saved: not in undo steps, autosave or project
   files (see docJSON). It is rebuilt by refresh() when a drawing is opened or an undo step is
   restored. Text layout is the slow part, so recent layouts are kept here. */
const textLayouts = new Map();
function layoutText(o) {
  const key = o.font + '|' + o.size + '|' + o.align + '|' + o.lh + '|' + (o.ls || 0) + '|' + o.text + (o.runs ? '\u0000' + JSON.stringify(o.runs) : '');
  let g = textLayouts.get(key);
  if (g) { textLayouts.delete(key); textLayouts.set(key, g); return g; }   // keep recently used ones
  g = buildText(o);
  textLayouts.set(key, g);
  if (textLayouts.size > 400) textLayouts.delete(textLayouts.keys().next().value);
  return g;
}
// The drawing as JSON, without derived outlines (the keys 'd' and 'parts' on an object; a path's own nat.d is kept)
const docJSON = d => JSON.stringify(d, function (k, v) { return (k === 'd' || k === 'parts') && this && this.kind ? undefined : v; });
function rebuildOutlines(d) { d.objects.forEach(o => { try { refresh(o); } catch (e) { /* drawn as nothing until fixed */ } }); }

function refresh(o) {
  if (o.kind === 'text') { const g = layoutText(o); o.d = g.d; o.w = g.w; o.h = g.h; if (g.parts) o.parts = g.parts; else delete o.parts; }
  else if (o.kind === 'polygon') o.d = buildPolygon(o);
  else if (o.kind === 'path') o.d = scaledPathD(o.nat, o.w, o.h);
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
  if (st.grad && !given('fill') && !given('grad') && kind !== 'text' && !KIND_INFO[kind].pixels) { o.grad = cloneGrad(st.grad); o.fill = o.grad.stops[0].c; }
  if (kind === 'rect' && o.r === undefined) o.r = 0;
  if (kind === 'polygon') { o.sides = o.sides || 6; o.star = !!o.star; o.inner = o.inner || 0.45; }
  if (kind === 'text') {
    o.text = o.text !== undefined ? o.text : ' '; o.font = o.font || DEFAULT_FONT; o.size = o.size || 64;   // a new text starts as one space: selected for typing over, and dropped if nothing is typed (see finishTextEdit)
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
}

