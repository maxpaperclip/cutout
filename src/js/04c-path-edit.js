/* =====================================================================
   Path editing: shared by the Pen tool and point editing
   A path object's outline (o.d) is stored in its own box coordinates (0,0 = top-left of the box),
   and drawn on the page through its flip and turn. Points are edited in those box coordinates, so
   a turned or mirrored shape stays turned or mirrored, and its gradient and photo stay where they
   were while the outline changes around them. After each change, writePath() fits the box to the
   new outline and moves it so nothing jumps on the page.
   ===================================================================== */
// Box coordinates to page coordinates, through flip and turn (and back)
function boxToWorld(o, lx, ly) {
  if (o.fx) lx = o.w - lx;
  if (o.fy) ly = o.h - ly;
  const r = rotPt(lx, ly, o.w / 2, o.h / 2, o.rot || 0);
  return [o.x + r.x, o.y + r.y];
}
function worldToBox(o, px, py) {
  const r = rotPt(px - o.x, py - o.y, o.w / 2, o.h / 2, -(o.rot || 0));
  return [o.fx ? o.w - r.x : r.x, o.fy ? o.h - r.y : r.y];
}
// A path object's outline as paper.js contours in box coordinates
const editablePath = o => new paper.CompoundPath({ pathData: o.d, insert: false });

// Put an edited outline (box coordinates of o0, the object as it was when the edit began) back into
// the object. The box is fitted to the outline and moved so the outline stays exactly where it is
// on the page; the photo fill and gradient keep their place on the page too.
function writePath(o, o0, path) {
  const b = path.bounds, W = o0.w, H = o0.h;
  const w = Math.max(b.width, 0.01), h = Math.max(b.height, 0.01);
  const shift = { x: b.x + b.width / 2 - W / 2, y: b.y + b.height / 2 - H / 2 };   // how far the middle moved, in box coordinates
  const c = boxToWorld(o0, W / 2 + shift.x, H / 2 + shift.y);
  const p = path.clone({ insert: false });
  p.translate(new paper.Point(-b.x, -b.y));
  const d = p.pathData;
  toPlainPath(o, d, w, h); o.x = c[0] - w / 2; o.y = c[1] - h / 2; o.rot = o0.rot || 0;
  if (o0.fx) o.fx = true; else delete o.fx;
  if (o0.fy) o.fy = true; else delete o.fy;
  if (o0.pic && o.pic) o.pic = Object.assign({}, o0.pic, { dx: o0.pic.dx - shift.x, dy: o0.pic.dy - shift.y });
  if (o0.grad && o.grad) {
    // same gradient on the page: its positions move from the old box to the new one
    const g0 = o0.grad, g = cloneGrad(g0), X = v => (v * W - b.x) / w, Y = v => (v * H - b.y) / h;
    if (g.type === 'linear') { g.x1 = X(g0.x1); g.y1 = Y(g0.y1); g.x2 = X(g0.x2); g.y2 = Y(g0.y2); }
    else {
      g.cx = X(g0.cx); g.cy = Y(g0.cy); g.r = g0.r * Math.sqrt((W * H) / (w * h));
      if (g0.fx !== undefined) { g.fx = X(g0.fx); g.fy = Y(g0.fy); }
    }
    o.grad = sanitizeGrad(g) || o.grad;
  }
  return o;
}

/* ---------- points and handles ----------
   paper.js keeps each point's two curve handles as offsets from the point. A point is "smooth"
   when its handles point in opposite directions (so the curve flows through it) and "sharp"
   (a corner) otherwise. */
const hasHandle = v => v.x * v.x + v.y * v.y > 1e-6;
function isSmoothPoint(seg) {
  const a = seg.handleIn, b = seg.handleOut;
  if (!hasHandle(a) || !hasHandle(b)) return false;
  return Math.abs(a.x * b.y - a.y * b.x) < 1e-3 * a.length * b.length && a.x * b.x + a.y * b.y < 0;
}
// Make a point smooth (handles along the direction between its neighbours) or sharp (no handles)
function setPointSmooth(seg, smooth) {
  if (!smooth) { seg.handleIn = new paper.Point(0, 0); seg.handleOut = new paper.Point(0, 0); return; }
  const prev = seg.previous, next = seg.next;
  if (!prev && !next) return;
  const P = seg.point, a = prev ? prev.point : P, c = next ? next.point : P;
  let dir = c.subtract(a);
  if (!hasHandle(dir)) dir = new paper.Point(1, 0);
  dir = dir.normalize();
  const lin = prev ? P.getDistance(a) / 3 : 0, lout = next ? P.getDistance(c) / 3 : 0;
  seg.handleIn = dir.multiply(-(lin || lout));
  seg.handleOut = dir.multiply(lout || lin);
}
// Move one handle. On a smooth point the other handle turns to stay opposite (keeping its own
// length), unless free is set (Alt), which bends just the one handle.
function moveHandle(seg, which, vec, free) {
  const smooth = isSmoothPoint(seg);
  const v = new paper.Point(vec.x, vec.y);
  if (which === 'in') seg.handleIn = v; else seg.handleOut = v;
  if (free || !smooth || !hasHandle(v)) return;
  const other = which === 'in' ? seg.handleOut : seg.handleIn;
  const turned = v.normalize().multiply(-other.length);
  if (which === 'in') seg.handleOut = turned; else seg.handleIn = turned;
}
// The contour and segment for a point key "c:s"
function segmentAt(path, key) {
  const [ci, si] = key.split(':').map(Number), c = path.children[ci];
  return c && c.segments[si] ? c.segments[si] : null;
}
// Remove points. A contour must keep 2 points (3 when closed); returns false if that would break it.
function removePoints(path, keys) {
  const by = new Map();
  keys.forEach(k => { const [ci, si] = k.split(':').map(Number); if (!by.has(ci)) by.set(ci, []); by.get(ci).push(si); });
  for (const [ci, list] of by) {
    const c = path.children[ci]; if (!c) continue;
    if (c.segments.length - list.length < (c.closed ? 3 : 2)) return false;
  }
  by.forEach((list, ci) => { list.sort((a, b) => b - a).forEach(si => path.children[ci].removeSegment(si)); });
  return true;
}
// Add a point on the outline nearest to p (box coordinates), keeping the curve's shape.
// Returns the new point's key, or null.
function insertPointNear(path, x, y) {
  const loc = path.getNearestLocation(new paper.Point(x, y));
  if (!loc || !loc.curve) return null;
  const c = loc.path, seg = c.divideAt(loc);
  if (!seg) return null;
  return path.children.indexOf(c) + ':' + seg.index;
}

/* ---------- Pen tool geometry ----------
   pts: the placed points in page coordinates, each { x, y, hin, hout } with handle offsets.
   Returns { d, x, y, w, h } with d in box coordinates, like pencilGeometry, or null. */
function penGeometry(pts, closed) {
  if (pts.length < 2) return null;
  const path = new paper.Path({
    segments: pts.map(p => new paper.Segment(new paper.Point(p.x, p.y), new paper.Point(p.hin.x, p.hin.y), new paper.Point(p.hout.x, p.hout.y))),
    closed: !!closed, insert: false
  });
  const b = path.bounds;
  if (b.width < 0.5 && b.height < 0.5) return null;
  path.translate(new paper.Point(-b.x, -b.y));
  return { d: path.pathData, x: b.x, y: b.y, w: Math.max(b.width, 0.01), h: Math.max(b.height, 0.01) };
}
// Snap a point to 45-degree steps from another (Shift while placing)
function snap45(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}

/* ---------- straight lines ----------
   A line is a plain shape (path) with just two points and no curve: there is no separate kind.
   The Line tool makes one, and anything with that outline (a pen line with two clicks, say) gets
   the line's endpoint handles and X1 / Y1 / X2 / Y2 fields. */
const lineCache = new Map();   // outline -> its two ends in box coordinates, or null
function lineEnds(o) {
  if (!o || o.kind !== 'path' || typeof o.d !== 'string') return null;
  let e = lineCache.get(o.d);
  if (e === undefined) {
    e = null;
    try {
      const p = new paper.CompoundPath({ pathData: o.d, insert: false }), c = p.children;
      if (c.length === 1 && !c[0].closed && c[0].segments.length === 2 && c[0].segments.every(s => !hasHandle(s.handleIn) && !hasHandle(s.handleOut)))
        e = c[0].segments.map(s => [s.point.x, s.point.y]);
    } catch (err) { e = null; }
    lineCache.set(o.d, e);
    if (lineCache.size > 500) lineCache.delete(lineCache.keys().next().value);
  }
  return e ? e.map(p => boxToWorld(o, p[0], p[1])) : null;   // page coordinates, through flip and turn
}
const isStraightLine = o => !!lineEnds(o);
// The box and outline for a line from a to b (page coordinates)
function lineGeometry(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  const d = 'M' + rnd(a.x - x, 3) + ' ' + rnd(a.y - y, 3) + 'L' + rnd(b.x - x, 3) + ' ' + rnd(b.y - y, 3);
  const W = Math.max(w, 0.01), H = Math.max(h, 0.01);   // a flat line still has a (very thin) box
  return { x, y, w: W, h: H, nat: { d, w: W, h: H } };
}
// A new line with the line tool's usual look (an outline, never a fill); props can override it
function makeLine(a, b, props) {
  const st = S.style;
  return newShape('path', Object.assign({ fill: 'none', stroke: st.stroke === 'none' ? '#151936' : st.stroke, sw: Math.max(st.sw, 3) }, lineGeometry(a, b), props || {}));
}
// Move a line's ends (page coordinates). Any turn or flip is built into the new ends.
function setLineEnds(o, a, b) {
  Object.assign(o, lineGeometry(a, b)); o.rot = 0; delete o.fx; delete o.fy;
  refresh(o);
}
