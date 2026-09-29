/* =====================================================================
   Rendering: canvas objects
   ===================================================================== */
const stage = $('#stage'), world = $('#world'), layerG = $('#layer'), ov = $('#overlay');
const els = new Map(), clipEls = new Map(), gradEls = new Map(), picDefs = $('#pic-defs');
const ATTR_KEYS = ['fill', 'stroke', 'stroke-width', 'stroke-linejoin', 'stroke-dasharray', 'stroke-linecap', 'opacity', 'rx', 'transform', 'href', 'preserveAspectRatio'];
function applyAttrs(e, attrs) {
  ATTR_KEYS.forEach(k => { if (!(k in attrs)) setA(e, k, null); });
  for (const k in attrs) setA(e, k, attrs[k]);
}

// Keep an object's gradient definition in <defs> up to date; returns its id
const GRAD_ATTRS = ['gradientUnits', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'fx', 'fy', 'gradientTransform'];
function syncGrad(o) {
  const spec = gradSpec(o), id = 'gr-' + o.id;
  let ge = gradEls.get(o.id);
  if (!ge || ge.tagName !== spec.tag) {
    if (ge) ge.remove();
    ge = svgEl(spec.tag, { id }); picDefs.appendChild(ge); gradEls.set(o.id, ge);
  }
  GRAD_ATTRS.forEach(k => setA(ge, k, k in spec.a ? spec.a[k] : null));
  const key = JSON.stringify(spec.stops);
  if (ge._stops !== key) {
    ge._stops = key; ge.textContent = '';
    spec.stops.forEach(st => ge.appendChild(svgEl('stop', st)));
  }
  return id;
}

function syncObjects() {
  const seen = new Set(), clipSeen = new Set(), gradSeen = new Set();
  doc.objects.forEach(o => {
    seen.add(o.id);
    let g = els.get(o.id);
    if (!g) { g = svgEl('g'); g.dataset.id = o.id; els.set(o.id, g); }
    const gid = hasGrad(o) ? syncGrad(o) : null;
    if (gid) gradSeen.add(o.id);
    const spec = geomSpec(o), st = styleAttrs(o, gid);
    if (!g._main || g._main.tagName !== spec.tag) {
      if (g._main) g._main.remove();
      g._main = svgEl(spec.tag);
      g.insertBefore(g._main, g.firstChild);
    }
    if (hasPic(o)) {
      // photo fill: color underneath, photo clipped to the shape, outline on top
      const pg = picGeom(o), org = drawOrigin(o);
      applyAttrs(g._main, Object.assign({}, spec.a, { fill: st.fill, stroke: 'none' }));
      setA(g._main, 'display', picCovers(o) ? 'none' : null);
      let cp = clipEls.get(o.id);
      if (!cp) { cp = svgEl('clipPath', { id: 'pc-' + o.id }); picDefs.appendChild(cp); clipEls.set(o.id, cp); }
      clipSeen.add(o.id);
      if (!cp._shape || cp._shape.tagName !== spec.tag) { if (cp._shape) cp._shape.remove(); cp._shape = svgEl(spec.tag); cp.appendChild(cp._shape); }
      applyAttrs(cp._shape, spec.a);
      if (!g._pic) { g._pic = svgEl('g'); g._img = svgEl('image', { preserveAspectRatio: 'none' }); g._pic.appendChild(g._img); g.appendChild(g._pic); }
      setA(g._pic, 'clip-path', 'url(#pc-' + o.id + ')');
      setA(g._img, 'x', rnd(org.x + pg.x, 3)); setA(g._img, 'y', rnd(org.y + pg.y, 3));
      setA(g._img, 'width', rnd(pg.w, 3)); setA(g._img, 'height', rnd(pg.h, 3));
      setA(g._img, 'href', pg.rec.dataUrl); setA(g._img, 'transform', spec.a.transform);
      if (g._edge && g._edge.tagName !== spec.tag) { g._edge.remove(); g._edge = null; }
      if (!g._edge) { g._edge = svgEl(spec.tag); g.appendChild(g._edge); }
      applyAttrs(g._edge, Object.assign({}, spec.a, { fill: 'none' }, strokeAttrs(o)));
      setA(g._edge, 'display', st.stroke === 'none' ? 'none' : null);
      setA(g, 'opacity', st.opacity !== undefined ? st.opacity : null);
    } else {
      applyAttrs(g._main, Object.assign({}, spec.a, st));
      setA(g._main, 'display', null);
      if (g._pic) { g._pic.remove(); g._pic = g._img = null; }
      if (g._edge) { g._edge.remove(); g._edge = null; }
      setA(g, 'opacity', null);
    }
    setA(g, 'display', o.hidden ? 'none' : null);
    // Anything drawn only as an outline (lines, pencil lines, shapes with no fill) gets a wider,
    // invisible outline to click on, so thin strokes are easy to select
    const outlineOnly = o.kind === 'line' || (o.kind !== 'image' && !hasPic(o) && !hasGrad(o) && (!o.fill || o.fill === 'none'));
    if (outlineOnly) {
      if (g._hit && g._hit.tagName !== spec.tag) { g._hit.remove(); g._hit = null; }
      if (!g._hit) { g._hit = svgEl(spec.tag, { class: 'obj-hit' }); g.appendChild(g._hit); }
      applyAttrs(g._hit, Object.assign({}, spec.a, { fill: null, stroke: null, 'stroke-width': rnd(Math.max(o.sw || 0, 16 / view.z), 3) }));
    } else if (g._hit) { g._hit.remove(); g._hit = null; }
  });
  els.forEach((g, id) => { if (!seen.has(id)) { g.remove(); els.delete(id); } });
  clipEls.forEach((cp, id) => { if (!clipSeen.has(id)) { cp.remove(); clipEls.delete(id); } });
  gradEls.forEach((ge, id) => { if (!gradSeen.has(id)) { ge.remove(); gradEls.delete(id); } });
  let ref = layerG.firstChild;
  doc.objects.forEach(o => {
    const g = els.get(o.id);
    if (g === ref) ref = ref.nextSibling; else layerG.insertBefore(g, ref);
  });
}

/* ---------- artboard, grid, view ---------- */
const abBg = $('#ab-bg'), abFrame = $('#ab-frame'), gridRect = $('#grid-rect'), gridPat = $('#gridpat'), gridPath = $('#gridpath'), outside = $('#outside');
function drawArtboard() {
  [abBg, abFrame, gridRect].forEach(r => { setA(r, 'width', doc.w); setA(r, 'height', doc.h); });
  setA(abBg, 'fill', doc.bg === 'transparent' ? 'url(#checker)' : doc.bg);
  const showGrid = S.showGrid && S.grid * view.z >= 5;
  setA(gridRect, 'display', showGrid ? null : 'none');
  setA(gridPat, 'width', S.grid); setA(gridPat, 'height', S.grid);
  setA(gridPath, 'd', 'M' + S.grid + ' 0H0V' + S.grid);
  setA(gridPath, 'stroke-width', rnd(1 / view.z, 4));
  setA(outside, 'd', 'M-100000 -100000H100000V100000H-100000Z M0 0V' + doc.h + 'H' + doc.w + 'V0Z');
}
function applyView() {
  setA(world, 'transform', 'translate(' + rnd(view.x, 2) + ' ' + rnd(view.y, 2) + ') scale(' + rnd(view.z, 5) + ')');
  $('#z-label').textContent = Math.round(view.z * 100) + '%';
  drawArtboard(); syncObjects(); drawOverlay();
}
function stageSize() { const r = stage.getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left, top: r.top }; }
function fit() {
  const s = stageSize(), pad = s.w < 600 ? 20 : 48;
  const z = clamp(Math.min((s.w - pad * 2) / doc.w, (s.h - pad * 2) / doc.h), 0.05, 4);
  view.z = z; view.x = (s.w - doc.w * z) / 2; view.y = (s.h - doc.h * z) / 2;
  applyView();
}
function zoomAt(f, sx, sy) {
  const nz = clamp(view.z * f, 0.05, 32), k = nz / view.z;
  view.x = sx - (sx - view.x) * k; view.y = sy - (sy - view.y) * k; view.z = nz;
  applyView();
}
function zoomCenter(f) { userView = true; const s = stageSize(); zoomAt(f, s.w / 2, s.h / 2); }

/* ---------- selection overlay ---------- */
function drawOverlay() {
  if (S.tool === 'perspective') { perspOverlay(); return; }
  ov.textContent = '';
  if (drag && drag.type === 'pencil') { pencilPreview(); return; }
  const z = view.z;
  if (drag && drag.type === 'marquee' && drag.cur) {
    const r = drag.rect();
    ov.appendChild(svgEl('rect', { x: r.x, y: r.y, width: r.w, height: r.h, class: 'ov-line ov-fill' }));
  }
  const sel = selObjs().filter(o => !o.hidden);
  if (!sel.length || (drag && drag.type === 'marquee')) return;
  const hs = 9 / z;
  if (sel.length === 1) {
    const o = sel[0];
    if (o.kind === 'line') {
      ov.appendChild(svgEl('line', { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, class: 'ov-line ov-dash' }));
      [['p1', o.x1, o.y1], ['p2', o.x2, o.y2]].forEach(h => ov.appendChild(svgEl('circle', { cx: h[1], cy: h[2], r: 6 / z, class: 'handle', 'data-h': h[0] })));
    } else {
      const c = centerOf(o);
      const g = svgEl('g', { transform: o.rot ? 'rotate(' + o.rot + ' ' + c.x + ' ' + c.y + ')' : null });
      g.appendChild(svgEl('rect', { x: o.x, y: o.y, width: o.w, height: o.h, class: 'ov-line' }));
      const names = (o.kind === 'text' || o.kind === 'image') ? ['nw', 'ne', 'se', 'sw'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
      names.forEach(n => {
        const hx = n.includes('e') ? 1 : n.includes('w') ? 0 : 0.5, hy = n.includes('s') ? 1 : n.includes('n') ? 0 : 0.5;
        g.appendChild(svgEl('rect', { x: o.x + hx * o.w - hs / 2, y: o.y + hy * o.h - hs / 2, width: hs, height: hs, rx: hs * 0.18, class: 'handle', 'data-h': n }));
      });
      const ry = o.y - 26 / z;
      g.appendChild(svgEl('line', { x1: c.x, y1: o.y, x2: c.x, y2: ry, class: 'ov-line' }));
      g.appendChild(svgEl('circle', { cx: c.x, cy: ry, r: 5.5 / z, class: 'handle rot', 'data-h': 'rot' }));
      ov.appendChild(g);
    }
  } else {
    sel.forEach(o => {
      if (o.kind === 'line') { ov.appendChild(svgEl('line', { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, class: 'ov-line' })); return; }
      const c = centerOf(o);
      ov.appendChild(svgEl('rect', { x: o.x, y: o.y, width: o.w, height: o.h, class: 'ov-line', transform: o.rot ? 'rotate(' + o.rot + ' ' + c.x + ' ' + c.y + ')' : null }));
    });
    const u = unionBox(sel);
    ov.appendChild(svgEl('rect', { x: u.x, y: u.y, width: u.w, height: u.h, class: 'ov-line ov-dash' }));
  }
}

