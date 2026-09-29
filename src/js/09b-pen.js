/* =====================================================================
   Pen tool and point editing
   Pen (B): click to place sharp corners; click and drag to place a smooth, curved point. Shift keeps
   lines and handles to 45-degree steps. Click the first point to close the shape. Enter, Esc or a
   double-click finishes an open line; Backspace takes back the last point. The pen stays selected
   so several paths can be drawn in a row.
   Point editing: double-click a shape (or choose Edit points) to see its points. Drag points and
   curve handles; handles on a smooth point stay opposite each other unless Alt is held. Click the
   outline to add a point, double-click a point to make it smooth or sharp, Delete removes points and
   the arrow keys nudge them. Enter or Esc finishes. Each drag is one undo step.
   The geometry is in 04c-path-edit.js; this file is only the pointer and keyboard handling.
   ===================================================================== */
let pen = null;   // the path being drawn: { pts: [{ x, y, hin, hout }], hover } in page coordinates
let pe = null;    // point editing: { id, sel: Set of 'contour:segment' keys }
const PEN_CLOSE = 10;   // screen pixels from the first point that close the shape
const pathBar = () => $('#path-bar');
function showPathBar() {
  const bar = pathBar(); if (!bar) return;
  const on = !!pe || S.tool === 'pen';
  bar.hidden = !on;
  if (!on) return;
  $('#path-hint').textContent = pe
    ? 'Drag points and handles. Click the outline to add a point, double-click a point to make it smooth or sharp. Delete removes points.'
    : pen && pen.pts.length
      ? 'Click to add corners, drag to make curves. Click the first point to close the shape, or press Enter to finish.'
      : 'Click to place a point. Click and drag to make a curve.';
  $('#path-done').textContent = pe ? 'Done' : 'Finish';
  $('#path-done').disabled = !pe && !(pen && pen.pts.length >= 2);
}

/* ---------- drawing with the pen ---------- */
const penLast = () => pen.pts[pen.pts.length - 1];
function penDown(e, p) {
  let q = snapPt(p);
  if (!pen) { pen = { pts: [] }; S.sel = new Set(); }
  const first = pen.pts[0];
  if (pen.pts.length >= 2 && Math.hypot(p.x - first.x, p.y - first.y) * view.z <= PEN_CLOSE) { penFinish(true); return; }
  if (e.shiftKey && pen.pts.length) q = snap45(penLast(), q);
  pen.pts.push({ x: q.x, y: q.y, hin: { x: 0, y: 0 }, hout: { x: 0, y: 0 } });
  drag = { type: 'pen', i: pen.pts.length - 1, sx: e.clientX, sy: e.clientY };
  refreshAll();
}
// Dragging out from a new point pulls its curve handles
function updatePenDrag(p, e) {
  const pt = pen && pen.pts[drag.i]; if (!pt) return;
  if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
  let v = { x: p.x - pt.x, y: p.y - pt.y };
  if (e.shiftKey) v = snap45({ x: 0, y: 0 }, v);
  pt.hout = v; pt.hin = { x: -v.x, y: -v.y };
  drawOverlay();
}
function penHover(p, e) {
  if (!pen || !pen.pts.length) return;
  pen.hover = e.shiftKey ? snap45(penLast(), snapPt(p)) : snapPt(p);
  drawOverlay();
}
// Make the object (closed: a filled shape; open: a line) and get ready for the next one
function penFinish(closed) {
  const pts = pen ? pen.pts : [];
  pen = null;
  const g = penGeometry(pts, closed);
  if (!g) { refreshAll(); return; }
  const props = { name: closed ? 'Pen shape' : 'Pen line', x: g.x, y: g.y, w: g.w, h: g.h, nat: { d: g.d, w: g.w, h: g.h } };
  if (!closed) Object.assign(props, { fill: 'none', stroke: pencilStroke(), sw: pencilWidth() });
  else if (S.style.stroke === 'none' && (S.style.fill === 'none' && !S.style.grad)) Object.assign(props, { stroke: pencilStroke(), sw: pencilWidth() });   // never invisible
  const o = newShape('path', props);
  doc.objects.push(o); S.sel = new Set([o.id]);
  commit();
}
function penUndoPoint() {
  if (!pen) return;
  pen.pts.pop();
  if (!pen.pts.length) pen = null;
  refreshAll();
}
// What the pen has placed so far, the curve it would add next, and its points and handles
function penOverlay() {
  if (!pen || !pen.pts.length) return;
  const z = view.z, pts = pen.pts, f = v => rnd(v, 2);
  let d = 'M' + f(pts[0].x) + ' ' + f(pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    d += 'C' + f(a.x + a.hout.x) + ' ' + f(a.y + a.hout.y) + ' ' + f(b.x + b.hin.x) + ' ' + f(b.y + b.hin.y) + ' ' + f(b.x) + ' ' + f(b.y);
  }
  ov.appendChild(svgEl('path', { d, fill: 'none', stroke: pencilStroke(), 'stroke-width': pencilWidth(), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none', opacity: 0.85 }));
  ov.appendChild(svgEl('path', { d, class: 'ov-line' }));
  const last = penLast(), h = pen.hover;
  if (h && !drag) {
    const closing = pts.length >= 2 && Math.hypot(h.x - pts[0].x, h.y - pts[0].y) * z <= PEN_CLOSE;
    const to = closing ? pts[0] : h;
    ov.appendChild(svgEl('path', { d: 'M' + f(last.x) + ' ' + f(last.y) + 'C' + f(last.x + last.hout.x) + ' ' + f(last.y + last.hout.y) + ' ' + f(to.x) + ' ' + f(to.y) + ' ' + f(to.x) + ' ' + f(to.y), class: 'ov-line ov-dash' }));
    if (closing) ov.appendChild(svgEl('circle', { cx: pts[0].x, cy: pts[0].y, r: 9 / z, class: 'pe-close' }));
  }
  pts.forEach((p, i) => {
    if (hasHandle(p.hout) && i === pts.length - 1) [p.hin, p.hout].forEach(v => {
      ov.appendChild(svgEl('line', { x1: p.x, y1: p.y, x2: p.x + v.x, y2: p.y + v.y, class: 'ov-line' }));
      ov.appendChild(svgEl('circle', { cx: p.x + v.x, cy: p.y + v.y, r: 3.5 / z, class: 'handle pe-knob' }));
    });
    const s = (i === 0 ? 9 : 7) / z;
    ov.appendChild(svgEl('rect', { x: p.x - s / 2, y: p.y - s / 2, width: s, height: s, class: 'handle pe-pt' + (i === pts.length - 1 ? ' on' : ''), 'pointer-events': 'none' }));
  });
}

/* ---------- editing points ---------- */
const peObj = () => { const o = pe && byId(pe.id); return o && o.kind === 'path' && !isLocked(o) && !isHidden(o) ? o : null; };
function enterPointEdit(o) {
  if (!o || o.kind === 'line' || o.kind === 'image' || isLocked(o)) return;
  if (pen) penFinish(false);
  if (S.tool !== 'select') setTool('select');
  S.sel = new Set([o.id]);
  if (o.kind !== 'path') flattenSelected();   // shapes and text become plain shapes, so their points can be moved
  pe = { id: o.id, sel: new Set() };
  refreshAll();
}
function exitPointEdit() { if (!pe) return; pe = null; refreshAll(); }
function peOverlay() {
  const o = peObj();
  if (!o || S.sel.size !== 1 || !S.sel.has(o.id)) { pe = null; showPathBar(); return false; }
  const z = view.z, path = editablePath(o), P = (x, y) => boxToWorld(o, x, y), wp = worldPaper(o);
  pe.sel.forEach(k => { if (!segmentAt(path, k)) pe.sel.delete(k); });   // after an undo, some points may be gone
  ov.appendChild(svgEl('path', { d: wp.pathData, class: 'ov-line' }));
  ov.appendChild(svgEl('path', { d: wp.pathData, class: 'pe-hit', 'stroke-width': 14 / z, 'data-h': 'pseg' }));
  // handles: on the selected points, and the ones facing them on their neighbours
  const show = new Set();
  pe.sel.forEach(k => { const s = segmentAt(path, k); if (!s) return; show.add(k + ':in'); show.add(k + ':out');
    const ci = k.split(':')[0];
    if (s.previous) show.add(ci + ':' + s.previous.index + ':out');
    if (s.next) show.add(ci + ':' + s.next.index + ':in'); });
  show.forEach(hk => {
    const [ci, si, which] = hk.split(':'), s = segmentAt(path, ci + ':' + si); if (!s) return;
    const v = which === 'in' ? s.handleIn : s.handleOut; if (!hasHandle(v)) return;
    const a = P(s.point.x, s.point.y), b = P(s.point.x + v.x, s.point.y + v.y);
    ov.appendChild(svgEl('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'ov-line' }));
    ov.appendChild(svgEl('circle', { cx: b[0], cy: b[1], r: 14 / z, class: 'q-hit', 'data-h': 'ph:' + hk }));
    ov.appendChild(svgEl('circle', { cx: b[0], cy: b[1], r: 4 / z, class: 'handle pe-knob', 'data-h': 'ph:' + hk }));
  });
  path.children.forEach((c, ci) => c.segments.forEach((s, si) => {
    const k = ci + ':' + si, a = P(s.point.x, s.point.y), on = pe.sel.has(k), sz = (on ? 9 : 8) / z;
    ov.appendChild(svgEl('circle', { cx: a[0], cy: a[1], r: 14 / z, class: 'q-hit', 'data-h': 'pa:' + k }));
    // smooth points are round, sharp points are square, as in most drawing programs
    ov.appendChild(isSmoothPoint(s)
      ? svgEl('circle', { cx: a[0], cy: a[1], r: sz / 2, class: 'handle pe-pt' + (on ? ' on' : ''), 'data-h': 'pa:' + k })
      : svgEl('rect', { x: a[0] - sz / 2, y: a[1] - sz / 2, width: sz, height: sz, class: 'handle pe-pt' + (on ? ' on' : ''), 'data-h': 'pa:' + k }));
  }));
  return true;
}
// A pointer press while editing points. Returns false when it wasn't meant for the points
// (then point editing ends and the press is handled as usual).
function peDown(e, p) {
  const o = peObj(); if (!o) { exitPointEdit(); return false; }
  const h = e.target.closest && e.target.closest('[data-h]'), hn = h ? h.dataset.h : '';
  const snap = JSON.parse(JSON.stringify(o));
  if (hn.startsWith('pa:')) {
    const k = hn.slice(3), now = performance.now();
    // A double-click switches the point between smooth and sharp. It's detected here rather than with
    // the browser's dblclick, because the first click redraws the points and the browser then sees
    // the second click land on a different element.
    if (pe.last && pe.last.k === k && now - pe.last.t < 400 && !e.shiftKey) { pe.last = null; peToggleSmooth(k); return true; }
    pe.last = { k, t: now };
    if (e.shiftKey) { if (pe.sel.has(k)) { pe.sel.delete(k); drawOverlay(); return true; } pe.sel.add(k); }
    else if (!pe.sel.has(k)) pe.sel = new Set([k]);
    drag = { type: 'pepoint', o0: snap, start: p, keys: [...pe.sel], sx: e.clientX, sy: e.clientY, moved: false };
    drawOverlay(); return true;
  }
  if (hn.startsWith('ph:')) {
    const parts = hn.split(':');
    drag = { type: 'pehandle', o0: snap, key: parts[1] + ':' + parts[2], which: parts[3], moved: false };
    return true;
  }
  if (hn === 'pseg') {
    const path = editablePath(o), lp = worldToBox(o, p.x, p.y), k = insertPointNear(path, lp[0], lp[1]);
    if (!k) return true;
    writePath(o, snap, path);
    pe.sel = new Set([k]);
    // keep holding to drag the new point into place; either way it's one undo step
    drag = { type: 'pepoint', o0: JSON.parse(JSON.stringify(o)), start: p, keys: [k], sx: e.clientX, sy: e.clientY, moved: true };
    render(); return true;
  }
  const g = e.target.closest && e.target.closest('[data-id]');
  if (g && +g.dataset.id === o.id) { pe.sel = new Set(); drawOverlay(); return true; }   // inside the shape: clear the chosen points
  exitPointEdit();
  return false;
}
function updatePePoint(p, e) {
  const d = drag, o = byId(d.o0.id); if (!o) return;
  if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return;
  d.moved = true; pe.last = null;
  let q = snapPt(p);
  if (e.shiftKey) { if (Math.abs(q.x - d.start.x) > Math.abs(q.y - d.start.y)) q.y = d.start.y; else q.x = d.start.x; }
  const a = worldToBox(d.o0, d.start.x, d.start.y), b = worldToBox(d.o0, q.x, q.y);
  const path = editablePath(d.o0);
  d.keys.forEach(k => { const s = segmentAt(path, k); if (s) s.point = s.point.add(new paper.Point(b[0] - a[0], b[1] - a[1])); });
  writePath(o, d.o0, path);
  render();
}
function updatePeHandle(p, e) {
  const d = drag, o = byId(d.o0.id); if (!o) return;
  d.moved = true;
  const path = editablePath(d.o0), s = segmentAt(path, d.key); if (!s) return;
  const lp = worldToBox(d.o0, p.x, p.y);
  let v = { x: lp[0] - s.point.x, y: lp[1] - s.point.y };
  if (e.shiftKey) v = snap45({ x: 0, y: 0 }, v);
  moveHandle(s, d.which, v, e.altKey);
  writePath(o, d.o0, path);
  render();
}
// Double-click a point to switch it between smooth and sharp
function peToggleSmooth(key) {
  const o = peObj(); if (!o) return;
  const snap = JSON.parse(JSON.stringify(o)), path = editablePath(o), s = segmentAt(path, key); if (!s) return;
  setPointSmooth(s, !isSmoothPoint(s));
  writePath(o, snap, path);
  pe.sel = new Set([key]);
  commit();
}
function peRemove() {
  const o = peObj(); if (!o || !pe.sel.size) return;
  const snap = JSON.parse(JSON.stringify(o)), path = editablePath(o);
  if (!removePoints(path, [...pe.sel])) { toast('A line needs at least two points, and a closed shape needs three.'); return; }
  writePath(o, snap, path);
  pe.sel = new Set();
  commit();
}
function peNudge(dx, dy) {
  const o = peObj(); if (!o || !pe.sel.size) return;
  const snap = JSON.parse(JSON.stringify(o)), path = editablePath(o);
  const c = boxToWorld(o, o.w / 2, o.h / 2), a = worldToBox(o, c[0], c[1]), b = worldToBox(o, c[0] + dx, c[1] + dy);   // a page nudge, in box coordinates
  pe.sel.forEach(k => { const s = segmentAt(path, k); if (s) s.point = s.point.add(new paper.Point(b[0] - a[0], b[1] - a[1])); });
  writePath(o, snap, path);
  commit();
}

/* ---------- keys ---------- */
// Returns true when the pen or point editing used the key
function pathKeys(e) {
  const k = e.key;
  if (pen && pen.pts.length) {
    if (k === 'Enter' || k === 'Escape') { e.preventDefault(); if (pen.pts.length >= 2) penFinish(false); else { pen = null; refreshAll(); } return true; }
    if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); penUndoPoint(); return true; }
  }
  if (pe) {
    if (k === 'Enter' || k === 'Escape') { e.preventDefault(); exitPointEdit(); return true; }
    if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); peRemove(); return true; }
    if (k.startsWith('Arrow') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const st = e.shiftKey ? 10 : 1;
      if (pe.sel.size) peNudge(k === 'ArrowLeft' ? -st : k === 'ArrowRight' ? st : 0, k === 'ArrowUp' ? -st : k === 'ArrowDown' ? st : 0);
      return true;
    }
  }
  return false;
}
