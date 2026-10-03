/* =====================================================================
   Erasing (the mask behind the Eraser tool)
   Erasing never changes a photo. An object that has been erased carries o.erase, the id of a small
   picture in `images` (flagged mask: true) laid over the object's own box: white shows the object,
   black hides it, and grays fade it. The object is drawn through that picture as an SVG <mask>, so the
   canvas and every export use the same description (see objView in 05-svg-export.js).
   Each finished stroke is baked into a fresh mask picture; older ones stay put until the undo history
   lets go of them, so Undo is just the drawing's JSON stepping back.
   While a stroke is being drawn (or waiting to be saved) it lives in eraseLive and is drawn inside the
   mask as a plain vector path, so what you see while drawing is exactly what gets baked.
   The pointer handling and the baking are in 09c-eraser.js; this file is only the description.

   The Brush tool paints with the same machinery. A paint layer is a photo-like object (kind 'image',
   o.paint: true) covering the page, whose picture each stroke repaints: the stroke is drawn as a
   colored vector path over the layer while it is pending, then baked into a new picture. The Eraser
   on a paint layer removes paint from that picture instead of using a mask.
   ===================================================================== */
const ERASE = {
  feather: 0.2,     // blur (as a fraction of the brush size) at full softness
  minSize: 2, maxSize: 200
};
// object id -> strokes drawn but not yet saved: { d (box coordinates), size, soft, open } plus
//   eraser strokes: restore (true brings parts back)      paint strokes: paint: true, color, alpha, smooth
const eraseLive = new Map();
const eraseBusy = () => eraseLive.size > 0;
// What can be erased (today: photos; the mask itself works on any object)
const canErase = o => !!o && hasPixels(o);

// A stroke's outline in the object's own box coordinates. A dot is a zero-length line, drawn with round ends.
const erasePathStart = (x, y) => { const p = rnd(x, 2) + ' ' + rnd(y, 2); return 'M' + p + 'L' + p; };
const erasePathMore = (x, y) => 'L' + rnd(x, 2) + ' ' + rnd(y, 2);
// A stroke's outline as it grows. A smooth stroke curves through the midpoints between the pointer's
// positions (so it has no corners at the pointer's own sampling rate) and runs out to the last position
// when it ends; a plain one just joins the positions with lines.
function strokeBegin(s, x, y) { s.d = erasePathStart(x, y); s.last = [x, y]; }
function strokeAdd(s, x, y) {
  const l = s.last;
  s.d += s.smooth ? 'Q' + rnd(l[0], 2) + ' ' + rnd(l[1], 2) + ' ' + rnd((l[0] + x) / 2, 2) + ' ' + rnd((l[1] + y) / 2, 2) : erasePathMore(x, y);
  s.last = [x, y];
}
function strokeEnd(s) { if (s.smooth) s.d += erasePathMore(s.last[0], s.last[1]); }
const eraseSigma = s => rnd(clamp(s.soft || 0, 0, 1) * s.size * ERASE.feather, 3);
// Room around the object's box in which the mask is defined (an outline can reach past the box)
const erasePad = o => Math.max(o.sw || 0, 0) * 2 + 24;
// A paint layer's picture has this many pixels per page unit (less when the page is big, so a layer
// never needs more than LIMITS.edge pixels on its long side)
const PAINT = { density: 2 };
const paintSize = o => {
  const k = Math.min(PAINT.density, LIMITS.edge / Math.max(o.w, o.h, 1));
  return [Math.max(1, Math.round(o.w * k)), Math.max(1, Math.round(o.h * k))];
};
// A layer picture that has never been painted on is a 1 x 1 clear stand-in (see 09d-brush.js)
const isBlankPaint = rec => !rec || rec.blank || (rec.w === 1 && rec.h === 1);

// One stroke as a path (and the blur it needs, if soft). In a mask, black hides and white brings back;
// a paint stroke is in its own color and opacity.
// fid: the id for its blur definition.
function eraseStrokeParts(s, fid, o) {
  const sigma = eraseSigma(s), m = rnd(s.size + 3 * sigma, 2), defs = [];
  if (sigma >= 0.05) defs.push({ tag: 'filter', a: { id: fid, filterUnits: 'userSpaceOnUse', x: -m, y: -m, width: rnd(o.w + 2 * m, 2), height: rnd(o.h + 2 * m, 2), 'color-interpolation-filters': 'sRGB' },
    kids: [{ tag: 'feGaussianBlur', a: { stdDeviation: sigma } }] });
  const color = s.paint ? s.color : s.restore ? '#fff' : '#000';
  return { defs, a: { d: s.d, fill: 'none', stroke: color, 'stroke-width': rnd(s.size, 2), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: s.paint && s.alpha < 1 ? rnd(s.alpha, 3) : null, filter: defs.length ? 'url(#' + fid + ')' : null } };
}

// The mask for an object, as definitions for objView: null when nothing is erased.
// The mask covers the page area around the object: white behind everything (so outlines past the box
// stay visible), then the saved mask picture in the object's box, then any strokes not yet saved.
function eraseView(o, id) {
  const rec = o.erase ? images.get(o.erase) : null, live = (eraseLive.get(o.id) || []).filter(s => !s.paint);
  if (!rec && !live.length) return null;
  const b = aabb(o), pad = erasePad(o), xf = objXf(o);
  const region = { x: rnd(b.x - pad, 2), y: rnd(b.y - pad, 2), width: rnd(b.w + pad * 2, 2), height: rnd(b.h + pad * 2, 2) };
  const defs = [], kids = [{ tag: 'rect', a: Object.assign({ fill: '#fff' }, region) }];
  if (rec) kids.push({ tag: 'image', a: { width: rnd(o.w, 3), height: rnd(o.h, 3), href: rec.dataUrl, preserveAspectRatio: 'none', transform: xf } });
  live.forEach((s, i) => {
    const p = eraseStrokeParts(s, id + '-s' + i, o);
    defs.push(...p.defs);
    kids.push({ tag: 'path', a: Object.assign({}, p.a, { transform: xf }) });
  });
  defs.push({ tag: 'mask', a: Object.assign({ id, maskUnits: 'userSpaceOnUse' }, region), kids });
  return { id, defs };
}

// Paint strokes not yet saved into a paint layer's picture, drawn over it as colored paths (for objView).
// A layer's own opacity is applied to them too, so the stroke looks the way it will once it is saved.
function paintView(o, id) {
  const live = (eraseLive.get(o.id) || []).filter(s => s.paint);
  if (!live.length) return null;
  const xf = objXf(o), lo = o.opacity < 1 ? o.opacity : 1, defs = [], kids = [];
  live.forEach((s, i) => {
    const p = eraseStrokeParts(s, id + '-p' + i, o), a = rnd(s.alpha * lo, 3);
    defs.push(...p.defs);
    kids.push({ tag: 'path', a: Object.assign({}, p.a, { transform: xf, opacity: a < 1 ? a : null }) });
  });
  return { defs, kids };
}

// Strokes as a stand-alone SVG, w x h pixels, covering the object's box (for baking into a mask picture)
function eraseStrokeSVG(o, strokes, w, h) {
  const defs = [], body = [];
  strokes.forEach((s, i) => { const p = eraseStrokeParts(s, 'ef' + i, o); defs.push(...p.defs); body.push(ser('path', p.a)); });
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + rnd(o.w, 3) + ' ' + rnd(o.h, 3) + '" preserveAspectRatio="none">' +
    (defs.length ? '<defs>' + defs.map(nodeToSVG).join('') + '</defs>' : '') + body.join('') + '</svg>';
}
