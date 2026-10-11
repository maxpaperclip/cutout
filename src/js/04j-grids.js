/* =====================================================================
   Grids: a column grid and a baseline grid (no DOM, unit tested)
   They are kept on the drawing (doc.grids), so they are saved with it, come back with Undo and
   Redo, and belong to that page. They are not objects: they are never in doc.objects, so they
   can't be selected, don't show in Layers and are never exported (see drawGrids in 08-rendering.js).

     doc.grids = { columns: {...}, baseline: {...} }     (absent until a setting is changed)

   Everything that is a position or a width is a PERCENTAGE of the page (of its width for the
   columns, of its height for the baseline margins), so the grid stretches with the page when its
   size changes. Only the baseline's own spacing is absolute, because it is a type size:
   spacing = font size x line height, the same two numbers a text has (o.size, o.lh).

     columns:  show, snap, count (1-24), gutter (% of the width), left, right (margins, % of the width),
               color, opacity (0.1-1; the panel shows it as transparency)
     baseline: show, snap, size (px), lh (a multiple of the size), top, bottom (where the grid
               begins and ends, % of the height), color, opacity
               (size and lh keep to the limits of a text's own size and line height, 4+ px and 0.6-3, so any text can be set to match)
   ===================================================================== */
const GRID_DEFAULTS = {
  columns: { show: false, snap: false, count: 12, gutter: 2, left: 5, right: 5, color: '#e5457a', opacity: 0.5 },
  baseline: { show: false, snap: false, size: 16, lh: 1.5, top: 5, bottom: 5, color: '#2f8fe0', opacity: 0.5 }
};
const GRID_MAX_LINES = 5000;   // however small the spacing, a baseline grid never draws more lines than this

const gridNum = (v, def, a, b) => { v = +v; return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : def; };
const gridRound = (v, n) => { const k = Math.pow(10, n); return Math.round(v * k) / k; };

// Any grids setting (a file's, or one being edited) made complete and safe: every value present and in range
function sanitizeGrids(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const c = r.columns && typeof r.columns === 'object' ? r.columns : {};
  const b = r.baseline && typeof r.baseline === 'object' ? r.baseline : {};
  const D = GRID_DEFAULTS, hex = (v, def) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : def;
  const cols = {
    show: !!c.show, snap: !!c.snap,
    count: Math.round(gridNum(c.count, D.columns.count, 1, 24)),
    gutter: gridNum(c.gutter, D.columns.gutter, 0, 20),
    left: gridNum(c.left, D.columns.left, 0, 45), right: gridNum(c.right, D.columns.right, 0, 45),
    color: hex(c.color, D.columns.color), opacity: gridNum(c.opacity, D.columns.opacity, 0.1, 1)
  };
  cols.right = Math.min(cols.right, 90 - cols.left);   // the margins leave at least a tenth of the page
  // and the gutters leave the columns some width: together at least a tenth of what the margins leave
  if (cols.count > 1) cols.gutter = Math.min(cols.gutter, (100 - cols.left - cols.right) * 0.9 / (cols.count - 1));
  ['gutter', 'left', 'right'].forEach(k => { cols[k] = gridRound(cols[k], 2); });
  cols.opacity = gridRound(cols.opacity, 2);
  const base = {
    show: !!b.show, snap: !!b.snap,
    size: gridNum(b.size, D.baseline.size, 4, 400), lh: gridNum(b.lh, D.baseline.lh, 0.6, 3),
    top: gridNum(b.top, D.baseline.top, 0, 45), bottom: gridNum(b.bottom, D.baseline.bottom, 0, 45),
    color: hex(b.color, D.baseline.color), opacity: gridNum(b.opacity, D.baseline.opacity, 0.1, 1)
  };
  base.bottom = Math.min(base.bottom, 90 - base.top);
  ['size', 'lh', 'top', 'bottom', 'opacity'].forEach(k => { base[k] = gridRound(base[k], 2); });
  return { columns: cols, baseline: base };
}
// The grids of a drawing, always complete (a drawing that never set any gets the defaults, with both off)
const gridsOf = d => sanitizeGrids(d && d.grids);

/* ---------- columns ---------- */
// Each column's left edge and width, in page units, for a page w wide
function columnBoxes(c, w) {
  const L = w * c.left / 100, R = w * c.right / 100, gut = w * c.gutter / 100, n = c.count;
  const cw = (w - L - R - gut * (n - 1)) / n, out = [];
  for (let i = 0; i < n; i++) out.push({ x: L + i * (cw + gut), w: cw });
  return out;
}
// Every x where a column starts or ends, left to right (with no gutter, neighbours share an edge: listed once)
function columnEdges(c, w) {
  const out = [];
  columnBoxes(c, w).forEach(b => [b.x, b.x + b.w].forEach(x => { x = gridRound(x, 3); if (!out.length || Math.abs(x - out[out.length - 1]) > 0.001) out.push(x); }));
  return out;
}
// One vertical line at each edge, the whole height of the page, as an SVG path
function columnGridPath(c, w, h) { return columnEdges(c, w).map(x => 'M' + x + ' 0V' + gridRound(h, 3)).join(''); }

/* ---------- baseline ---------- */
const baselineStep = b => b.size * b.lh;   // the distance between lines, in page units
// Where the lines start (y0), where they stop (y1), and how far apart they are, for a page h tall
function baselineRange(b, h) {
  const step = Math.max(baselineStep(b), h / GRID_MAX_LINES);
  return { y0: h * b.top / 100, y1: h - h * b.bottom / 100, step };
}
function baselineYs(b, h) {
  const r = baselineRange(b, h), out = [];
  for (let y = r.y0; y <= r.y1 + 0.001; y += r.step) out.push(gridRound(y, 3));
  return out;
}
// One horizontal line at each baseline, the whole width of the page
function baselineGridPath(b, w, h) { return baselineYs(b, h).map(y => 'M0 ' + y + 'H' + gridRound(w, 3)).join(''); }
// The baseline nearest to y, or null when the grid has no line there (it starts and stops at its margins)
function nearestBaseline(b, h, y) {
  const r = baselineRange(b, h);
  if (r.y1 < r.y0) return null;
  const last = Math.floor((r.y1 - r.y0) / r.step + 1e-9), k = Math.min(last, Math.max(0, Math.round((y - r.y0) / r.step)));
  return r.y0 + k * r.step;
}

/* ---------- snapping ---------- */
// True when a grid is showing and set to snap
const gridSnapOn = d => { const g = gridsOf(d); return (g.columns.show && g.columns.snap) || (g.baseline.show && g.baseline.snap); };
// The line of a showing, snapping grid that is within tol of v (axis 'x': column edges; 'y': baselines), or null
function nearGuide(d, axis, v, tol) {
  const g = gridsOf(d);
  if (axis === 'x') {
    if (!g.columns.show || !g.columns.snap) return null;
    let best = null;
    columnEdges(g.columns, d.w).forEach(x => { if (Math.abs(x - v) <= tol && (best === null || Math.abs(x - v) < Math.abs(best - v))) best = x; });
    return best;
  }
  if (!g.baseline.show || !g.baseline.snap) return null;
  const y = nearestBaseline(g.baseline, d.h, v);
  return y !== null && Math.abs(y - v) <= tol ? y : null;
}
// How far to shift something spanning lo..hi so that its start or its end edge lies on a line (the nearer one wins), or null
function guideShift(d, axis, lo, hi, tol) {
  const a = nearGuide(d, axis, lo, tol), b = nearGuide(d, axis, hi, tol);
  if (a === null && b === null) return null;
  const da = a === null ? Infinity : a - lo, db = b === null ? Infinity : b - hi;
  return Math.abs(da) <= Math.abs(db) ? da : db;
}
