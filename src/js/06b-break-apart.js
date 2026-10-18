/* =====================================================================
   Break apart: a text becomes one plain shape per letter, together in a new folder
   Each letter is cut out of the text's own layout (textLayout, 04f-text-layout.js), so it sits exactly
   where it was drawn, kerning included. The new shapes are made in the text's own box coordinates and then
   given the text's turn and mirroring, so a turned or mirrored text breaks apart into turned, mirrored letters
   that still line up. Because they keep that turn, a gradient or a photo fill (both measured from an object's own
   box) can be handed on to each letter without any extra turning: only the box changes.
   Spaces and line breaks get no shape. A letter with its accents is one shape. The hyphen that hyphenation puts at the end of a
   line (it is not in the text) gets a shape too. (Text is not drawn with ligatures
   here: opentype.js, called with the options buildText uses, draws "fi" as two glyphs, so the letters match the text.)
   No DOM, so it is unit tested.
   ===================================================================== */
// How many letters (not counting spaces and line breaks) a text may have to be broken apart. Every letter is a layer,
// so this keeps the Layers tab usable and the undo steps small. Raise it here if it turns out to be too tight.
const BREAK_APART_MAX = 100;

// The pieces of a text that get a shape each, in reading order: [{ i, n }] (where it starts in the text, and how many
// UTF-16 units long). Spaces and line breaks are left out; accents and other marks stay with the letter they follow.
function breakClusters(text) {
  const out = [], len = text.length, unitAt = k => text.codePointAt(k) > 0xFFFF ? 2 : 1;
  let i = 0;
  while (i < len) {
    let n = unitAt(i);
    if (/^\s$/u.test(text.slice(i, i + n))) { i += n; continue; }
    while (i + n < len && /^\p{M}$/u.test(text.slice(i + n, i + n + unitAt(i + n)))) n += unitAt(i + n);
    out.push({ i, n });
    i += n;
  }
  return out;
}

// A gradient of the whole text, for the letter whose ink box is (gx, gy, gw, gh) in the text's box coordinates (the text
// is W x H). Every position is a fraction of a box, so a linear gradient moves over exactly: the colors land where they were.
// A radial gradient's circle is stretched to its box (see gradSpec), and a letter's box has a different shape from the
// text's, so its center and focal point are exact and its size is the nearest it can be (same area).
function glyphGrad(g, W, H, gx, gy, gw, gh) {
  const c = cloneGrad(g), P = 1e3;   // (the limit sanitizeGrad keeps to when a drawing is opened)
  const px = x => clamp(rnd((x * W - gx) / gw, 5), -P, P), py = y => clamp(rnd((y * H - gy) / gh, 5), -P, P);
  if (c.type === 'linear') { c.x1 = px(c.x1); c.y1 = py(c.y1); c.x2 = px(c.x2); c.y2 = py(c.y2); }
  else {
    c.cx = px(c.cx); c.cy = py(c.cy);
    if (c.fx !== undefined && c.fy !== undefined) { c.fx = px(c.fx); c.fy = py(c.fy); }
    c.r = clamp(rnd(c.r * Math.sqrt((W * H) / (gw * gh)), 5), 0.001, P);
  }
  return c;
}

// The letters of a text as new plain shapes (not yet in the drawing), in reading order: { shapes }, or { why } when it can't be done.
function breakApartText(o) {
  const text = String(o.text), clusters = breakClusters(text);
  if (!clusters.length) return { why: 'There are no letters in this text to break apart.' };
  if (clusters.length > BREAK_APART_MAX) {
    return { why: 'Break apart works on up to ' + BREAK_APART_MAX + ' letters at a time, and this text has ' + clusters.length + '. Try splitting it into shorter texts first.' };
  }
  const lay = textLayout(o), shapes = [];
  // One shape for a bit of text drawn at (x, base) in the text's box: idx is where its style comes from (a letter's own color)
  const make = (str, font, x, base, size, ls, idx) => {
    const d = font.getPath(str, x, base, size, { kerning: true, letterSpacing: ls }).toPathData(2);
    if (!d) return;
    const item = new paper.CompoundPath({ pathData: d, insert: false }), bn = item.bounds;
    if (item.isEmpty() || (bn.width < 0.01 && bn.height < 0.01)) return;   // a letter the font has no outline for
    const gx = bn.x, gy = bn.y, gw = Math.max(bn.width, 0.01), gh = Math.max(bn.height, 0.01);
    item.translate(new paper.Point(-gx, -gy));
    // Where the middle of this letter is on the page: mirrored in the text's box, then turned about the box's middle
    const lcx = gx + gw / 2, lcy = gy + gh / 2;
    const c = rotPt(o.fx ? o.w - lcx : lcx, o.fy ? o.h - lcy : lcy, o.w / 2, o.h / 2, o.rot || 0);
    const s = newShape('path', {
      name: str, x: o.x + c.x - gw / 2, y: o.y + c.y - gh / 2, w: gw, h: gh, rot: o.rot || 0,
      nat: { d: item.pathData, w: gw, h: gh }
    });
    copyKeys(o, s, STYLE_KEYS.concat(['fx', 'fy', 'hidden', 'locked', 'parent']));
    const st = o.runs ? runStyleAt(o.runs, idx) : {};
    if (st.c !== undefined) { s.fill = st.c; delete s.grad; }   // a letter with a color of its own keeps just that color
    else if (o.grad) { s.grad = glyphGrad(o.grad, o.w, o.h, gx, gy, gw, gh); syncGradFill(s); }
    // The photo keeps its place on the page: its middle is the same distance from the text's middle as before
    if (o.pic) s.pic = { id: o.pic.id, dx: rnd(o.w / 2 + o.pic.dx - lcx, 3), dy: rnd(o.h / 2 + o.pic.dy - lcy, 3), s: o.pic.s };
    shapes.push(s);
  };
  lay.lines.forEach(L => {
    (lay.caps || []).filter(c => c.line === L.i).forEach(c => {   // the letters of a drop cap come first, before the lines beside it
      clusters.forEach(cl => { if (cl.i >= c.i0 && cl.i < c.i1) make(text.slice(cl.i, cl.i + cl.n), c.font, c.ox[cl.i - c.i0], c.base, c.size, c.ls, cl.i); });
    });
    clusters.forEach(cl => {
      if (cl.i < L.start || cl.i >= L.end) return;
      const col = cl.i - L.start, seg = L.segs.find(g => col >= g.a && col < g.b);
      if (!seg) return;
      make(text.slice(cl.i, cl.i + cl.n), seg.font, L.x + L.m.xs[col], L.base, seg.size, seg.ls, cl.i);
    });
    // The hyphen that ends a line cut inside a word is not in the text but is on the page, so it is a shape too
    if (L.hy) make('-', L.hy.font, L.x + L.hy.x, L.base, L.hy.size, L.hy.ls, L.end - 1);
  });
  if (!shapes.length) return { why: 'This text has no letters the font can draw, so there is nothing to break apart.' };
  return { shapes };
}

// Swap the selected text for its letters, in a folder named after the text (a single letter has no need of one)
function breakApartSelected() {
  const o = one();
  if (!o || o.kind !== 'text') { toast('Select a text to break apart.'); return; }
  if (isLocked(o)) { toast('This text is locked. Unlock it to break it apart.'); return; }
  const r = breakApartText(o);
  if (r.why) { toast(r.why); return; }
  const label = labelOf(o), at = doc.objects.indexOf(o);
  doc.objects.splice(at, 1, ...r.shapes);
  const ids = new Set(r.shapes.map(s => s.id));
  if (r.shapes.length > 1) {
    const g = groupObjects(doc, ids);
    if (g.group) g.group.name = label;
  }
  S.sel = ids;
  commit();
  toast(r.shapes.length > 1 ? 'Broken apart into ' + r.shapes.length + ' shapes, in a new folder.' : 'Turned into a plain shape.');
}
