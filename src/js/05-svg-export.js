/* =====================================================================
   SVG description of an object (shared by the editor and the exporter)
   ===================================================================== */
function strokeAttrs(o) {
  const a = { stroke: o.stroke && o.stroke !== 'none' ? o.stroke : 'none' };
  if (a.stroke !== 'none') {
    const sw = Math.max(o.sw, 0);
    a['stroke-width'] = sw;
    a['stroke-linejoin'] = o.join || 'miter';
    if (o.dash === 'dashed') a['stroke-dasharray'] = rnd(Math.max(sw, 1) * 3, 2) + ' ' + rnd(Math.max(sw, 1) * 2, 2);
    else if (o.dash === 'dotted') a['stroke-dasharray'] = '0 ' + rnd(Math.max(sw, 1) * 2, 2);
    const auto = (o.kind === 'line' || isOpenPath(o)) && o.dash === 'solid' ? 'round' : 'butt';
    const cap = CAPS.indexOf(o.cap) >= 0 ? o.cap : auto;
    // dots are drawn as zero-length dashes, which only show with round or square ends
    a['stroke-linecap'] = o.dash === 'dotted' ? (cap === 'square' ? 'square' : 'round') : cap;
  }
  return a;
}
// gradId: the id of this object's gradient definition, when it has one (see gradSpec)
function styleAttrs(o, gradId) {
  if (o.kind === 'image') return o.opacity < 1 ? { opacity: rnd(o.opacity, 3) } : {};
  const fill = gradId && hasGrad(o) ? 'url(#' + gradId + ')' : o.fill && o.fill !== 'none' ? o.fill : 'none';
  const a = Object.assign({ fill }, strokeAttrs(o));
  if (o.opacity < 1) a.opacity = rnd(o.opacity, 3);
  return a;
}
// Transform about the object's center: flip (fx/fy) first, then rotate
function centerXf(o, cx, cy) {
  const flip = o.fx || o.fy;
  if (!o.rot && !flip) return null;
  if (!flip) return 'rotate(' + rnd(o.rot, 3) + ' ' + rnd(cx, 3) + ' ' + rnd(cy, 3) + ')';
  return 'translate(' + rnd(cx, 3) + ' ' + rnd(cy, 3) + ')' + (o.rot ? ' rotate(' + rnd(o.rot, 3) + ')' : '') +
    ' scale(' + (o.fx ? -1 : 1) + ' ' + (o.fy ? -1 : 1) + ') translate(' + rnd(-cx, 3) + ' ' + rnd(-cy, 3) + ')';
}
// Geometry only (no transform), in the object's own drawing coordinates
function shapeSpec(o) {
  switch (o.kind) {
    case 'rect': return { tag: 'rect', a: { x: rnd(o.x, 3), y: rnd(o.y, 3), width: rnd(o.w, 3), height: rnd(o.h, 3), rx: o.r > 0 ? rnd(Math.min(o.r, o.w / 2, o.h / 2), 3) : null } };
    case 'ellipse': return { tag: 'ellipse', a: { cx: rnd(o.x + o.w / 2, 3), cy: rnd(o.y + o.h / 2, 3), rx: rnd(o.w / 2, 3), ry: rnd(o.h / 2, 3) } };
    case 'line': return { tag: 'line', a: { x1: rnd(o.x1, 3), y1: rnd(o.y1, 3), x2: rnd(o.x2, 3), y2: rnd(o.y2, 3) } };
    case 'image': {
      const rec = images.get(o.img);
      if (!rec) return { tag: 'rect', a: { x: rnd(o.x, 3), y: rnd(o.y, 3), width: rnd(o.w, 3), height: rnd(o.h, 3), fill: '#cfd3e0' } };
      return { tag: 'image', a: { x: rnd(o.x, 3), y: rnd(o.y, 3), width: rnd(o.w, 3), height: rnd(o.h, 3), href: rec.dataUrl, preserveAspectRatio: 'none' } };
    }
    default: return { tag: 'path', a: { d: o.d } };
  }
}
// Transform that places the object on the page
function objXf(o) {
  if (o.kind === 'line') return null;
  if (o.kind === 'rect' || o.kind === 'ellipse' || o.kind === 'image') return centerXf(o, o.x + o.w / 2, o.y + o.h / 2);
  const local = centerXf(o, o.w / 2, o.h / 2);
  return 'translate(' + rnd(o.x, 3) + ' ' + rnd(o.y, 3) + ')' + (local ? ' ' + local : '');
}
function geomSpec(o) {
  const s = shapeSpec(o);
  s.a = Object.assign({}, s.a, { transform: objXf(o) });
  return s;
}
/* ---------- gradient fills ----------
   The gradient is defined in the same coordinates the shape is drawn in (userSpaceOnUse), and the
   shape's own transform is applied on top of both, so the gradient turns and flips with the shape.
   Linear gradients are laid out in real box units, which keeps the color bands at right angles to
   the gradient line on any box. Radial gradients are drawn as a unit circle scaled to the box,
   so they stretch into an ellipse that fits the shape. */
function gradSpec(o) {
  const g = o.grad, org = drawOrigin(o), w = o.w, h = o.h;
  const stops = g.stops.map(s => ({ offset: rnd(s.at, 4), 'stop-color': s.c, 'stop-opacity': s.a < 1 ? rnd(s.a, 3) : null }));
  if (g.type === 'radial') {
    const sx = Math.max(g.r * w, 1e-3), sy = Math.max(g.r * h, 1e-3), focal = g.fx !== undefined && g.fy !== undefined;
    return { tag: 'radialGradient', stops, a: {
      gradientUnits: 'userSpaceOnUse', cx: 0, cy: 0, r: 1,
      fx: focal ? rnd((g.fx - g.cx) / g.r, 4) : null, fy: focal ? rnd((g.fy - g.cy) / g.r, 4) : null,
      gradientTransform: 'translate(' + rnd(org.x + g.cx * w, 3) + ' ' + rnd(org.y + g.cy * h, 3) + ') scale(' + rnd(sx, 4) + ' ' + rnd(sy, 4) + ')'
    } };
  }
  return { tag: 'linearGradient', stops, a: {
    gradientUnits: 'userSpaceOnUse',
    x1: rnd(org.x + g.x1 * w, 3), y1: rnd(org.y + g.y1 * h, 3), x2: rnd(org.x + g.x2 * w, 3), y2: rnd(org.y + g.y2 * h, 3)
  } };
}
// The gradient as SVG markup, wrapped in <defs>, for export
function gradToSVG(o, id) {
  const g = gradSpec(o);
  return '<defs>' + serOpen(g.tag, Object.assign({ id }, g.a)) + g.stops.map(s => ser('stop', s)).join('') + '</' + g.tag + '></defs>';
}

/* ---------- photo fills ---------- */
// Where the photo sits inside a shape, in the shape's own box coordinates (0,0 = top-left of the box)
function picGeom(o) {
  const rec = images.get(o.pic.id), pw = rec.w * o.pic.s, ph = rec.h * o.pic.s;
  return { x: o.w / 2 + o.pic.dx - pw / 2, y: o.h / 2 + o.pic.dy - ph / 2, w: pw, h: ph, rec };
}
// True when the photo covers the whole shape box, so the fill color underneath is never visible
function picCovers(o) { const g = picGeom(o); return g.x <= 0.05 && g.y <= 0.05 && g.x + g.w >= o.w - 0.05 && g.y + g.h >= o.h - 0.05; }
// rect / ellipse are drawn in page coordinates, everything else in box coordinates
const drawOrigin = o => (o.kind === 'rect' || o.kind === 'ellipse') ? { x: o.x, y: o.y } : { x: 0, y: 0 };
const coverScale = (o, rec) => Math.max(o.w / rec.w, o.h / rec.h);
// Scale the photo along with its shape when the shape is resized
function rescalePic(o, pic0, sx, sy) { o.pic = { id: pic0.id, dx: pic0.dx * sx, dy: pic0.dy * sy, s: pic0.s * Math.max(sx, sy) }; }

function serOpen(tag, attrs) {
  let s = '<' + tag;
  for (const k in attrs) { const v = attrs[k]; if (v !== null && v !== undefined && v !== '') s += ' ' + k + '="' + esc(v) + '"'; }
  return s + '>';
}
function ser(tag, attrs) { return serOpen(tag, attrs).slice(0, -1) + '/>'; }
function picToSVG(o, spec, clipId, gradId) {
  const st = styleAttrs(o, gradId), pg = picGeom(o), org = drawOrigin(o), sa = strokeAttrs(o);
  let s = '<g' + (st.opacity !== undefined ? ' opacity="' + st.opacity + '"' : '') + '>';
  if (st.fill !== 'none' && !picCovers(o)) s += (hasGrad(o) && gradId ? gradToSVG(o, gradId) : '') + ser(spec.tag, Object.assign({}, spec.a, { fill: st.fill }));
  s += '<clipPath id="' + clipId + '">' + ser(spec.tag, spec.a) + '</clipPath>';
  s += '<g clip-path="url(#' + clipId + ')">' + ser('image', { x: rnd(org.x + pg.x, 3), y: rnd(org.y + pg.y, 3), width: rnd(pg.w, 3), height: rnd(pg.h, 3), href: pg.rec.dataUrl, preserveAspectRatio: 'none', transform: spec.a.transform }) + '</g>';
  if (sa.stroke !== 'none') s += ser(spec.tag, Object.assign({}, spec.a, { fill: 'none' }, sa));
  return s + '</g>';
}
function objToSVG(o, clipId, gradId) {
  const spec = geomSpec(o);
  gradId = hasGrad(o) ? (gradId || ('gr' + o.id)) : null;
  const body = hasPic(o) ? picToSVG(o, spec, clipId || ('pc' + o.id), gradId)
    : (gradId ? gradToSVG(o, gradId) : '') + ser(spec.tag, Object.assign({}, spec.a, styleAttrs(o, gradId)));
  const blend = blendOf(o);   // the whole object (fill, photo and outline) blends as one
  return blend ? '<g style="mix-blend-mode:' + blend + '">' + body + '</g>' : body;
}
function buildSVG(objs, box, outW, outH, bg) {
  const parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + rnd(outW, 2) + '" height="' + rnd(outH, 2) + '" viewBox="' + rnd(box.x, 3) + ' ' + rnd(box.y, 3) + ' ' + rnd(box.w, 3) + ' ' + rnd(box.h, 3) + '">'];
  if (bg) parts.push('<rect x="' + rnd(box.x, 3) + '" y="' + rnd(box.y, 3) + '" width="' + rnd(box.w, 3) + '" height="' + rnd(box.h, 3) + '" fill="' + esc(bg) + '"/>');
  let n = 0;
  objs.forEach(o => { if (!isHidden(o)) { ++n; parts.push(objToSVG(o, 'pc' + n, 'gr' + n)); } });   // hidden, or inside a hidden group
  parts.push('</svg>');
  return parts.join('');
}

