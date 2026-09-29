/* =====================================================================
   Groups (shown as folders in the Layers tab)
   The drawing stays one flat list, doc.objects, in stacking order (bottom first). That is what
   rendering, export, Combine and Perspective work on, so none of them need to know about groups.
   Groups are kept beside it:
     doc.groups = [{ id, name, parent, hidden, locked }]   parent: the id of the group it sits in, or null
     o.parent   = the id of the group an object sits in (absent when it isn't in one)
   Groups and objects share one id counter (doc.nextId), so an id means one thing only.
   normalizeGroups() keeps this tidy: it drops empty groups and broken links, and keeps each
   group's members next to each other in the stacking order, gathered where its top member is.
   Most functions here take the drawing (d) as an argument so they can be tested on their own.
   ===================================================================== */
const groupById = (d, id) => (id === undefined || id === null) ? null : d.groups.find(g => g.id === id) || null;
// The groups an object (or group) sits in, innermost first
function ancestorsOf(d, item) {
  const out = [], seen = new Set();
  let g = groupById(d, item.parent);
  while (g && !seen.has(g.id)) { out.push(g); seen.add(g.id); g = groupById(d, g.parent); }
  return out;
}
// Hidden or locked when the object is, or any group it sits in is
const effHidden = (d, o) => !!o.hidden || ancestorsOf(d, o).some(g => g.hidden);
const effLocked = (d, o) => !!o.locked || ancestorsOf(d, o).some(g => g.locked);
const inGroup = (d, o, gid) => ancestorsOf(d, o).some(g => g.id === gid);
// Every object inside a group, including inside the groups within it, bottom first
const groupLeaves = (d, gid) => d.objects.filter(o => inGroup(d, o, gid));
// The outermost group an object sits in, or null
function topGroupOf(d, o) { const a = ancestorsOf(d, o); return a.length ? a[a.length - 1] : null; }

/* ---------- the tree ----------
   Built fresh from the flat list whenever it is needed. A node is { g, children } for a group or
   { o } for an object; children are listed top first, the way the Layers tab shows them. */
function buildTree(d) {
  const root = { children: [] }, nodes = new Map();
  for (let i = d.objects.length - 1; i >= 0; i--) {
    const o = d.objects[i];
    let at = root;
    ancestorsOf(d, o).reverse().forEach(g => {
      let n = nodes.get(g.id);
      if (!n) { n = { g, children: [] }; nodes.set(g.id, n); at.children.push(n); }
      at = n;
    });
    at.children.push({ o });
  }
  return root;
}
// Back to the flat stacking order (bottom first)
function flattenTree(root) {
  const out = [];
  (function walk(n) { for (let i = n.children.length - 1; i >= 0; i--) { const c = n.children[i]; if (c.o) out.push(c.o); else walk(c); } })(root);
  return out;
}
function nodeLeaves(n) {
  if (n.o) return [n.o];
  const out = [];
  n.children.forEach(c => out.push(...nodeLeaves(c)));
  return out;
}
const nodeParent = n => n.o ? (n.o.parent !== undefined ? n.o.parent : null) : n.g.parent;
const setNodeParent = (n, pid) => { const t = n.o || n.g; if (pid === null || pid === undefined) { if (n.o) delete t.parent; else t.parent = null; } else t.parent = pid; };

// Repair and tidy the groups. Safe to run any time; returns d.
function normalizeGroups(d) {
  if (!Array.isArray(d.groups)) d.groups = [];
  const ids = new Set(d.groups.map(g => g.id));
  d.groups.forEach(g => { if (g.parent === undefined || !ids.has(g.parent) || g.parent === g.id) g.parent = null; });
  // break any loop of groups sitting inside each other
  d.groups.forEach(g => {
    const seen = new Set([g.id]);
    let p = groupById(d, g.parent);
    while (p) { if (seen.has(p.id)) { g.parent = null; break; } seen.add(p.id); p = groupById(d, p.parent); }
  });
  d.objects.forEach(o => { if (o.parent !== undefined && !ids.has(o.parent)) delete o.parent; });
  // a group with nothing in it is removed
  const used = new Set();
  d.objects.forEach(o => ancestorsOf(d, o).forEach(g => used.add(g.id)));
  if (used.size !== d.groups.length) d.groups = d.groups.filter(g => used.has(g.id));
  d.objects = flattenTree(buildTree(d));
  return d;
}

/* ---------- selection units ----------
   The selection is always a set of objects. A "unit" is what a command should treat as one
   thing: a whole group when all of it is selected, otherwise a single object. */
function selectionUnits(d, sel) {
  const units = [];
  const visit = n => {
    if (n.o) { if (sel.has(n.o.id)) units.push(n); return; }
    const leaves = nodeLeaves(n);
    if (leaves.length && leaves.every(o => sel.has(o.id))) { units.push(n); return; }
    n.children.forEach(visit);
  };
  buildTree(d).children.forEach(visit);   // the drawing itself is never a unit
  return units;
}
// What a click on an object selects: its whole outermost group, or just the object
function clickUnit(d, o) { const g = topGroupOf(d, o); return g ? groupLeaves(d, g.id) : [o]; }

// Put the selected units into a new group. Returns the new group, or null (with the reason in .why).
function groupObjects(d, sel) {
  const units = selectionUnits(d, sel);
  const count = units.reduce((n, u) => n + nodeLeaves(u).length, 0);
  if (units.length < 2) {
    return { why: count ? 'Select two or more things to group.' : 'Select the things you want to group.' };
  }
  const parents = new Set(units.map(nodeParent));
  const parent = parents.size === 1 ? [...parents][0] : null;   // stay inside the shared group, if there is one
  const g = { id: d.nextId++, name: '', parent, hidden: false, locked: false };
  d.groups.push(g);
  units.forEach(u => setNodeParent(u, g.id));
  normalizeGroups(d);
  return { group: g };
}
// Take apart the selected groups; what was inside moves up one level. Returns the number undone.
function ungroupObjects(d, sel) {
  const gone = selectionUnits(d, sel).filter(u => u.g).map(u => u.g);
  if (!gone.length) return 0;
  const ids = new Set(gone.map(g => g.id));
  const up = id => { let p = id; while (p !== null && ids.has(p)) p = groupById(d, p).parent; return p; };
  d.objects.forEach(o => { if (o.parent !== undefined && ids.has(o.parent)) setNodeParent({ o }, up(o.parent)); });
  d.groups.forEach(g => { if (!ids.has(g.id) && g.parent !== null && ids.has(g.parent)) g.parent = up(g.parent); });
  d.groups = d.groups.filter(g => !ids.has(g.id));
  normalizeGroups(d);
  return gone.length;
}

/* ---------- stacking order by unit ----------
   Bring forward / send backward / to front / to back move whole selected units among their
   siblings, so a group stays in one piece and never mixes with things outside it. */
function reorderUnits(d, sel, how) {
  const root = buildTree(d);
  const picked = n => nodeLeaves(n).length > 0 && nodeLeaves(n).every(o => sel.has(o.id));
  (function walk(n) {
    const ch = n.children;   // top first
    if (how === 'front') n.children = ch.filter(picked).concat(ch.filter(c => !picked(c)));
    else if (how === 'back') n.children = ch.filter(c => !picked(c)).concat(ch.filter(picked));
    else if (how === 'forward') { for (let i = 1; i < ch.length; i++) if (picked(ch[i]) && !picked(ch[i - 1])) { const t = ch[i]; ch[i] = ch[i - 1]; ch[i - 1] = t; i++; } }
    else if (how === 'backward') { for (let i = ch.length - 2; i >= 0; i--) if (picked(ch[i]) && !picked(ch[i + 1])) { const t = ch[i]; ch[i] = ch[i + 1]; ch[i + 1] = t; i--; } }
    n.children.forEach(c => { if (c.g && !picked(c)) walk(c); });
  })(root);
  d.objects = flattenTree(root);
}

/* ---------- copies ----------
   Copy objects along with any groups they fill completely, giving everything new ids.
   keepParent: for Duplicate, a copy of part of a group stays in that group. */
function copyWithGroups(d, objs, groups, keepParent) {
  const gmap = new Map();
  const newGroups = groups.map(g => { const c = { id: d.nextId++, name: g.name, parent: g.parent, hidden: !!g.hidden, locked: !!g.locked }; gmap.set(g.id, c.id); return c; });
  const liveIds = new Set(d.groups.map(g => g.id));
  const remap = pid => gmap.has(pid) ? gmap.get(pid) : (keepParent && liveIds.has(pid) ? pid : undefined);
  newGroups.forEach(g => { const p = remap(g.parent); g.parent = p === undefined ? null : p; });
  const newObjs = objs.map(o => {
    const c = JSON.parse(JSON.stringify(o));
    c.id = d.nextId++;
    const p = remap(o.parent);
    if (p === undefined) delete c.parent; else c.parent = p;
    return c;
  });
  return { objects: newObjs, groups: newGroups };
}
// The groups that the given objects fill completely (for copying a selection)
function groupsFilledBy(d, objs) {
  const ids = new Set(objs.map(o => o.id));
  return d.groups.filter(g => { const l = groupLeaves(d, g.id); return l.length && l.every(o => ids.has(o.id)); });
}

/* ---------- moving several objects as one ----------
   Scaling and turning a selection (or group) about a point, from a snapshot taken when the drag
   began (o0), so repeated moves never add up rounding errors. Scaling is always proportional:
   a turned object can be scaled evenly, but stretching it one way would need a skew, which
   Cutout's objects can't hold. Outline widths, corner rounding, text size and photo fills
   scale along with the shapes. */
function scaleAbout(o, o0, ax, ay, k) {
  if (o0.sw !== undefined) o.sw = rnd(o0.sw * k, 3);
  if (o.kind === 'line') {
    o.x1 = ax + (o0.x1 - ax) * k; o.y1 = ay + (o0.y1 - ay) * k; o.x2 = ax + (o0.x2 - ax) * k; o.y2 = ay + (o0.y2 - ay) * k;
    refresh(o); return;
  }
  const cx = ax + (o0.x + o0.w / 2 - ax) * k, cy = ay + (o0.y + o0.h / 2 - ay) * k;
  if (o.kind === 'text') { o.size = Math.max(1, rnd(o0.size * k, 3)); refresh(o); }
  else {
    o.w = Math.max(o0.w * k, 0.01); o.h = Math.max(o0.h * k, 0.01);
    if (o.kind === 'rect') o.r = (o0.r || 0) * k;
    refresh(o);
  }
  o.x = cx - o.w / 2; o.y = cy - o.h / 2;
  if (o0.pic && o.pic) rescalePic(o, o0.pic, k, k);
}
function rotateAbout(o, o0, cx, cy, deg) {
  if (o.kind === 'line') {
    const a = rotPt(o0.x1, o0.y1, cx, cy, deg), b = rotPt(o0.x2, o0.y2, cx, cy, deg);
    o.x1 = a.x; o.y1 = a.y; o.x2 = b.x; o.y2 = b.y; refresh(o); return;
  }
  const c = rotPt(o0.x + o0.w / 2, o0.y + o0.h / 2, cx, cy, deg);
  o.x = c.x - o0.w / 2; o.y = c.y - o0.h / 2;
  o.rot = rnd(normDeg((o0.rot || 0) + deg), 2);
}
const groupLabel = g => g.name || 'Group';

// Short forms for the app, which always works on the current drawing
const isHidden = o => effHidden(doc, o);
const isLocked = o => effLocked(doc, o);
