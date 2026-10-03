/* =====================================================================
   Pointer interaction
   ===================================================================== */
let drag = null, pinch = null, spaceDown = false, userView = false;
let psn = null;   // the live perspective session (see the Perspective section)
const pointers = new Map();
const MIN = 2;
const snapV = v => S.snap ? Math.round(v / S.grid) * S.grid : v;
const snapPt = p => ({ x: snapV(p.x), y: snapV(p.y) });
function toWorld(e) { const r = stage.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.z, y: (e.clientY - r.top - view.y) / view.z }; }

/* ---------- tools ----------
   Each tool is an entry in TOOLS saying what it does; each kind of drag is an entry in DRAGS.
   The pointer and keyboard handlers below only look things up, so a new tool (a brush, say) is
   an entry in each, in its own file, and nothing here has to change.
     TOOLS.name = { key: its keyboard shortcut, cursor: 'select' | 'hand' | 'draw' | 'text',
                    down(e, p), hover(e, p), dblclick(e, under): pointer, p in page coordinates
                    keys(e): return true when the key was used
                    overlay(): draw over the canvas; return true to skip the selection handles
                    enter(), leave(): when the tool is chosen, and when another is }
     DRAGS.type = { move(p, e), end(d, e), overlay(), cancel(d) }  for drag = { type, ... }
                  (cancel: a second finger arrived and the drag is abandoned) */
const TOOLS = {}, DRAGS = {};
const tool = () => TOOLS[S.tool] || {};
function setTool(t) {
  const prev = tool();
  if (prev.leave) prev.leave();   // also when the same tool is chosen again: it starts over
  S.tool = TOOLS[t] ? t : 'select';
  const cur = tool();
  if (cur.enter) cur.enter();
  $$('.tool[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === S.tool ? 'true' : 'false'));
  stage.setAttribute('class', 't-' + (cur.cursor || 'select') + (spaceDown ? ' panning' : ''));
  updateEmpty();
  drawOverlay();
}

stage.addEventListener('pointerdown', e => {
  if (psnBusy || (e.pointerType === 'mouse' && e.button === 2)) return;
  try { stage.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  closeMenus();
  if (pointers.size === 2) { startPinch(); return; }
  if (pointers.size > 2) return;
  if (e.button === 1 || S.tool === 'hand' || spaceDown) {   // any tool pans with the middle button or Space
    drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    stage.classList.add('panning');
    e.preventDefault();
    return;
  }
  const t = tool();
  if (t.down) t.down(e, toWorld(e));
});
stage.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) { updatePinch(); return; }
  if (!drag) { const t = tool(); if (t.hover) t.hover(e, toWorld(e)); return; }
  const k = DRAGS[drag.type];
  if (k && k.move) k.move(toWorld(e), e);
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; return; }
  if (!drag) return;
  const d = drag; drag = null;
  stage.classList.toggle('panning', spaceDown);
  const k = DRAGS[d.type];
  if (k && k.end) k.end(d, e); else drawOverlay();
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);
stage.addEventListener('contextmenu', e => e.preventDefault());
stage.addEventListener('wheel', e => {
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  userView = true;
  if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-clamp(e.deltaY, -60, 60) * 0.01), e.clientX - r.left, e.clientY - r.top);
  else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); }
}, { passive: false });
stage.addEventListener('dblclick', e => {
  // The stage holds on to the pointer during a click (for dragging), so the browser reports the
  // double-click as coming from the stage itself. Ask what is actually under the pointer instead.
  const under = document.elementFromPoint(e.clientX, e.clientY) || e.target, t = tool();
  if (t.dblclick) t.dblclick(e, under);
});

DRAGS.pan = { move(p, e) { userView = true; view.x = drag.vx + (e.clientX - drag.sx); view.y = drag.vy + (e.clientY - drag.sy); applyView(); } };
TOOLS.hand = { key: 'h', cursor: 'hand' };   // panning itself is handled above, for every tool

/* ---------- the Select tool ---------- */
TOOLS.select = {
  key: 'v', cursor: 'select',
  down(e, p) {
    if (pe && peDown(e, p)) return;   // editing points (see 09b-pen.js)
    const h = e.target.closest && e.target.closest('[data-h]');
    if (h) { beginHandle(h.dataset.h, p, e); return; }
    const g = e.target.closest && e.target.closest('[data-id]');
    const o = g ? byId(+g.dataset.id) : null;
    const pl = paintLayerAt(p, o && !isLocked(o) && !isHidden(o) ? o : null);   // paint above what was hit (see 09d-brush.js)
    if (pl) { beginMove(pl, p, e); return; }
    if (o && !isLocked(o) && !isHidden(o)) { beginMove(o, p, e); return; }
    beginMarquee(p, e);
  },
  dblclick(e, under) {
    if (pe) return;   // double-clicking a point is handled in peDown (see there)
    const g = under.closest && under.closest('[data-id]');
    const o = g ? byId(+g.dataset.id) : null;
    if (!o || isLocked(o) || isHidden(o)) return;
    // Double-click picks just this object, even inside a group; for text it also opens the editor,
    // and for a plain shape it shows its points for editing
    if (o.kind === 'text') { S.sel = new Set([o.id]); refreshAll(); openPanel(); focusText(); }
    else if (o.kind === 'path') { revealInLayers(o); enterPointEdit(o); }
    else if (o.parent !== undefined) { S.sel = new Set([o.id]); revealInLayers(o); refreshAll(); }
  },
  keys(e) {
    if (pe) return peKeys(e);
    // Enter on a plain shape shows its points
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.target.closest('button') && one() && one().kind === 'path') { e.preventDefault(); enterPointEdit(one()); return true; }
    return false;
  },
  overlay: () => !!(pe && peOverlay()),
  leave() { pe = null; }
};

/* ---------- pinch to zoom / two-finger pan ---------- */
function pinchState() {
  const [a, b] = Array.from(pointers.values()), r = stage.getBoundingClientRect();
  return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top };
}
function startPinch() {
  userView = true;
  const k = drag && DRAGS[drag.type];
  if (k && k.cancel) k.cancel(drag);   // a drag that keeps work outside the drawing (the eraser) drops it here
  if (drag && drag.type !== 'pan' && drag.type !== 'marquee') revertUncommitted();
  drag = null;
  const s = pinchState();
  pinch = { d0: s.d, mx0: s.mx, my0: s.my, v0: { x: view.x, y: view.y, z: view.z } };
}
function updatePinch() {
  const s = pinchState(), v0 = pinch.v0;
  const z = clamp(v0.z * s.d / pinch.d0, 0.05, 32);
  const wx = (pinch.mx0 - v0.x) / v0.z, wy = (pinch.my0 - v0.y) / v0.z;
  view.z = z; view.x = s.mx - wx * z; view.y = s.my - wy * z;
  applyView();
}

/* ---------- select / move ---------- */
function beginMove(o, p, e) {
  const multi = e.shiftKey || e.metaKey || e.ctrlKey;
  // A click picks the object's whole group. If just this object was picked (by double-clicking
  // into its group), it stays picked on its own, so it can be moved by itself.
  const unit = clickUnit(doc, o).filter(x => !isLocked(x) && !isHidden(x)).map(x => x.id);
  const whole = unit.every(id => S.sel.has(id));
  let collapseTo = null;
  if (multi) {
    if (S.sel.has(o.id)) { (whole ? unit : [o.id]).forEach(id => S.sel.delete(id)); refreshAll(); return; }
    unit.forEach(id => S.sel.add(id));
  } else if (!S.sel.has(o.id)) S.sel = new Set(unit);
  else if (selectionUnits(doc, S.sel).length > 1) collapseTo = whole ? unit : [o.id];
  drag = {
    type: 'move', start: p, sx: e.clientX, sy: e.clientY, moved: false, shift: multi, collapseTo,
    orig: selObjs().filter(x => !isLocked(x)).map(x => ({ id: x.id, x: x.x, y: x.y }))
  };
  refreshAll();
}
function updateMove(p, e) {
  if (!drag.moved) { if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return; drag.moved = true; }
  let dx = p.x - drag.start.x, dy = p.y - drag.start.y;
  if (e.shiftKey && !drag.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
  const a = drag.orig[0];
  if (a && S.snap) { dx = snapV(a.x + dx) - a.x; dy = snapV(a.y + dy) - a.y; }
  drag.orig.forEach(s => {
    const o = byId(s.id); if (!o) return;
    o.x = s.x + dx; o.y = s.y + dy;
  });
  render();
}

/* ---------- marquee ---------- */
function beginMarquee(p, e) {
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  const base = additive ? new Set(S.sel) : new Set();
  if (!additive) S.sel = new Set();
  drag = {
    type: 'marquee', start: p, cur: null, base,
    rect() { return { x: Math.min(this.start.x, this.cur.x), y: Math.min(this.start.y, this.cur.y), w: Math.abs(this.cur.x - this.start.x), h: Math.abs(this.cur.y - this.start.y) }; }
  };
  refreshAll();
}
function updateMarquee(p) {
  drag.cur = p;
  const r = drag.rect(), sel = new Set(drag.base);
  doc.objects.forEach(o => {
    if (isHidden(o) || isLocked(o) || o.paint) return;   // a paint layer covers the page, so dragging a box would always pick it
    const b = aabb(o);
    // touching any part of a group picks up the whole group
    if (b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y) clickUnit(doc, o).forEach(x => { if (!isHidden(x) && !isLocked(x)) sel.add(x.id); });
  });
  S.sel = sel;
  drawOverlay(); updateInspector(); renderLayers();
}

/* ---------- drawing ---------- */
function beginDraw(e, p) {
  drag = { type: 'draw', tool: S.tool, start: snapPt(p), sx: e.clientX, sy: e.clientY, id: null };
}
// Shapes and lines: drag to draw (or click for a default size), then back to Select
[['rect', 'r'], ['ellipse', 'e'], ['polygon', 'p'], ['star', 's'], ['line', 'l']].forEach(([t, key]) => { TOOLS[t] = { key, cursor: 'draw', down: beginDraw }; });
TOOLS.text = { key: 't', cursor: 'text', down: (e, p) => createText(p) };
DRAGS.draw = { move: (p, e) => updateDraw(p, e), end: (d, e) => finishDraw(d, e) };
function makeDrawn(tool, box) {
  if (tool === 'rect') return newShape('rect', box);
  if (tool === 'ellipse') return newShape('ellipse', box);
  if (tool === 'polygon') return newShape('polygon', Object.assign({ sides: 6 }, box));
  if (tool === 'star') return newShape('polygon', Object.assign({ sides: 5, star: true, inner: 0.45 }, box));
  return null;
}
function updateDraw(p, e) {
  const d = drag;
  if (!d.id && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
  let cur = snapPt(p);
  if (d.tool === 'line') {
    if (e.shiftKey) cur = constrainAngle(d.start, cur);
    let o = d.id ? byId(d.id) : null;
    if (!o) { o = makeLine(d.start, cur); doc.objects.push(o); d.id = o.id; S.sel = new Set([o.id]); }
    else setLineEnds(o, d.start, cur);
  } else {
    let x = Math.min(d.start.x, cur.x), y = Math.min(d.start.y, cur.y), w = Math.abs(cur.x - d.start.x), h = Math.abs(cur.y - d.start.y);
    if (e.shiftKey) {
      const m = Math.max(w, h); w = m; h = m;
      x = cur.x < d.start.x ? d.start.x - m : d.start.x; y = cur.y < d.start.y ? d.start.y - m : d.start.y;
    }
    w = Math.max(w, 1); h = Math.max(h, 1);
    let o = d.id ? byId(d.id) : null;
    if (!o) { o = makeDrawn(d.tool, { x, y, w, h }); doc.objects.push(o); d.id = o.id; S.sel = new Set([o.id]); }
    else { o.x = x; o.y = y; o.w = w; o.h = h; refresh(o); }
  }
  render();
}
function finishDraw(d, e) {
  if (!d.id) {
    // a plain click: drop a default-sized shape centered on the click
    const c = d.start, s = 120;
    let o;
    if (d.tool === 'line') o = makeLine({ x: c.x - 80, y: c.y }, { x: c.x + 80, y: c.y });
    else o = makeDrawn(d.tool, { x: c.x - s / 2, y: c.y - s / 2, w: s, h: s });
    if (!o) return;
    doc.objects.push(o); S.sel = new Set([o.id]);
  }
  setTool('select');
  commit();
}
/* ---------- pencil ----------
   Draws freehand. The raw path is shown as it is drawn, then smoothed into a shape on release
   (see pencilGeometry). The pencil stays selected so several strokes can be drawn in a row. */
const pencilStroke = () => S.style.stroke === 'none' ? '#151936' : S.style.stroke;
const pencilWidth = () => Math.max(S.style.sw, 3);
function beginPencil(p) {
  S.sel = new Set();
  drag = { type: 'pencil', pts: [p], d: 'M' + rnd(p.x, 2) + ' ' + rnd(p.y, 2) };
  drawOverlay(); updateInspector(); renderLayers();
}
function updatePencil(p) {
  const q = drag.pts[drag.pts.length - 1];
  if (Math.hypot(p.x - q.x, p.y - q.y) * view.z < 1) return;
  drag.pts.push(p); drag.d += 'L' + rnd(p.x, 2) + ' ' + rnd(p.y, 2);
  if (drag.el) setA(drag.el, 'd', drag.d); else drawOverlay();
}
// The stroke as it is being drawn, in the pencil's own color (called from drawOverlay)
function pencilPreview() {
  drag.el = svgEl('path', { d: drag.d, fill: 'none', stroke: pencilStroke(), 'stroke-width': pencilWidth(), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none' });
  ov.appendChild(drag.el);
}
function finishPencil(d) {
  const g = pencilGeometry(d.pts, view.z);
  if (!g) { drawOverlay(); return; }
  const props = { name: g.closed ? 'Drawn shape' : 'Drawn line', x: g.x, y: g.y, w: g.w, h: g.h, nat: { d: g.d, w: g.w, h: g.h },
    stroke: pencilStroke(), sw: pencilWidth(), join: 'round' };
  if (!g.closed) props.fill = 'none';   // a closed loop takes the current fill (and gradient) like any new shape
  const o = newShape('path', props);
  doc.objects.push(o); S.sel = new Set([o.id]);
  commit();
}
function constrainAngle(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}
function createText(p) {
  const sp = snapPt(p);
  const o = newShape('text', { x: sp.x, y: sp.y });
  doc.objects.push(o); S.sel = new Set([o.id]);
  setTool('select'); commit(); openPanel(); focusText();
}
function focusText() {
  switchTab('design');
  setTimeout(() => { const t = $('#tx-text'); t.focus(); t.select(); }, 30);
}

/* ---------- resize / rotate / line ends ---------- */
function beginHandle(h, p, e) {
  if (h[0] === 'm') { beginMultiHandle(h, p); return; }
  const o = one(); if (!o) return;
  if (h === 'rot') {
    const c = centerOf(o);
    drag = { type: 'rotate', id: o.id, c, a0: Math.atan2(p.y - c.y, p.x - c.x) / D2R, rot0: o.rot };
  } else if ((h === 'p1' || h === 'p2') && lineEnds(o)) {
    drag = { type: 'lineend', id: o.id, end: h === 'p1' ? 0 : 1 };
  } else {
    drag = { type: 'resize', id: o.id, h, o0: { x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot, size: o.size }, pic0: o.pic ? Object.assign({}, o.pic) : null };
  }
}
/* ---------- moving several objects as one ----------
   The handles around a group or a multiple selection. Corners scale everything in proportion
   from the opposite corner; the round handle turns everything around the middle. Each move
   starts again from the snapshot taken when the drag began (see scaleAbout / rotateAbout). */
function beginMultiHandle(h, p) {
  const sel = selObjs().filter(o => !isHidden(o));
  if (!sel.length || sel.some(isLocked)) return;
  const u0 = unionBox(sel), o0 = new Map(sel.map(o => [o.id, JSON.parse(JSON.stringify(o))]));
  if (h === 'mrot') {
    const cx = u0.x + u0.w / 2, cy = u0.y + u0.h / 2;
    drag = { type: 'mrotate', u0, o0, cx, cy, a0: Math.atan2(p.y - cy, p.x - cx) / D2R, theta: 0 };
  } else {
    drag = { type: 'mscale', u0, o0, ax: h.includes('w') ? u0.x + u0.w : u0.x, ay: h.includes('n') ? u0.y + u0.h : u0.y, sx: h.includes('w') ? -1 : 1, sy: h.includes('n') ? -1 : 1 };
  }
}
function updateMultiScale(p) {
  const d = drag, ks = [];
  if (d.u0.w > 1) ks.push((p.x - d.ax) * d.sx / d.u0.w);   // a very flat selection scales by its other side
  if (d.u0.h > 1) ks.push((p.y - d.ay) * d.sy / d.u0.h);
  const k = Math.max(ks.length ? Math.max(...ks) : 1, MIN / Math.max(1, Math.min(d.u0.w || 1, d.u0.h || 1)), 0.02);
  d.o0.forEach((s, id) => { const o = byId(id); if (o) scaleAbout(o, s, d.ax, d.ay, k); });
  render();
}
function updateMultiRotate(p, e) {
  const d = drag;
  let t = Math.atan2(p.y - d.cy, p.x - d.cx) / D2R - d.a0;
  if (e.shiftKey) t = Math.round(t / 15) * 15;
  d.theta = normDeg(t);
  d.o0.forEach((s, id) => { const o = byId(id); if (o) rotateAbout(o, s, d.cx, d.cy, d.theta); });
  render();
}
function updateRotate(p, e) {
  const o = byId(drag.id); if (!o) return;
  let r = drag.rot0 + (Math.atan2(p.y - drag.c.y, p.x - drag.c.x) / D2R - drag.a0);
  if (e.shiftKey) r = Math.round(r / 15) * 15;
  o.rot = rnd(normDeg(r), 2);
  render();
}
function updateLineEnd(p, e) {
  const o = byId(drag.id), ends = o && lineEnds(o); if (!ends) return;
  const pt = v => ({ x: v[0], y: v[1] }), other = pt(ends[1 - drag.end]);
  let q = snapPt(p);
  if (e.shiftKey) q = constrainAngle(other, q);
  if (drag.end === 0) setLineEnds(o, q, other); else setLineEnds(o, other, q);
  render();
}
function updateResize(p, e) {
  const o = byId(drag.id); if (!o) return;
  const o0 = drag.o0, hn = drag.h;
  if (S.snap && !o0.rot) p = snapPt(p);
  const c0 = { x: o0.x + o0.w / 2, y: o0.y + o0.h / 2 };
  const q = rotPt(p.x, p.y, c0.x, c0.y, -o0.rot), ux = q.x - c0.x, uy = q.y - c0.y;
  const hx = hn.includes('e') ? 1 : hn.includes('w') ? 0 : 0.5, hy = hn.includes('s') ? 1 : hn.includes('n') ? 0 : 0.5;
  const hw = o0.w / 2, hh = o0.h / 2;
  let L = -hw, R = hw, T = -hh, B = hh;
  if (hx === 1) R = Math.max(ux, L + MIN); else if (hx === 0) L = Math.min(ux, R - MIN);
  if (hy === 1) B = Math.max(uy, T + MIN); else if (hy === 0) T = Math.min(uy, B - MIN);
  let w = R - L, h = B - T;
  const uniform = e.shiftKey || keepsRatio(o);
  if (uniform) {
    let s;
    if (hx !== 0.5 && hy !== 0.5) s = Math.max(w / o0.w, h / o0.h);
    else if (hx !== 0.5) s = w / o0.w; else s = h / o0.h;
    s = Math.max(s, MIN / Math.max(1, Math.min(o0.w, o0.h)));
    if (o.kind === 'text') { o.size = Math.max(4, rnd(o0.size * s, 2)); refresh(o); w = o.w; h = o.h; }
    else { w = o0.w * s; h = o0.h * s; }
    if (hx === 1) R = L + w; else if (hx === 0) L = R - w; else { L = -w / 2; R = w / 2; }
    if (hy === 1) B = T + h; else if (hy === 0) T = B - h; else { T = -h / 2; B = h / 2; }
  }
  const cw = rotPt(c0.x + (L + R) / 2, c0.y + (T + B) / 2, c0.x, c0.y, o0.rot);
  o.w = w; o.h = h; o.x = cw.x - w / 2; o.y = cw.y - h / 2;
  if (o.kind !== 'text') refresh(o);
  if (drag.pic0) rescalePic(o, drag.pic0, o.w / o0.w, o.h / o0.h);
  render();
}


// The drags that belong to the Select tool, shapes and the pencil
DRAGS.move = {
  move: (p, e) => updateMove(p, e),
  end(d) {
    if (d.moved) commit();
    else if (d.collapseTo && !d.shift) { S.sel = new Set(d.collapseTo); refreshAll(); }
    else refreshAll();
  }
};
DRAGS.marquee = { move: (p, e) => updateMarquee(p, e), end: () => refreshAll() };
DRAGS.resize = { move: (p, e) => updateResize(p, e), end: () => commit() };
DRAGS.rotate = { move: (p, e) => updateRotate(p, e), end: () => commit() };
DRAGS.lineend = { move: (p, e) => updateLineEnd(p, e), end: () => commit() };
DRAGS.mscale = { move: p => updateMultiScale(p), end: () => commit() };
DRAGS.mrotate = { move: (p, e) => updateMultiRotate(p, e), end: () => commit() };
TOOLS.pencil = { key: 'n', cursor: 'draw', down: (e, p) => beginPencil(p) };
DRAGS.pencil = { move: p => updatePencil(p), end: d => finishPencil(d), overlay() { pencilPreview(); return true; } };
