/* =====================================================================
   Text layout with positions, and picking text by its box (no DOM; unit tested)
   Text is drawn as outlines (buildText, in 04-document-model.js), so the outlines, the caret, the
   selection highlight and a click on the text all have to agree about where every letter is. They
   all come from textLayout() below: the one place that decides it. Nothing asks the browser to lay
   text out, so what is drawn and what is edited cannot drift apart, however long the text.
   Everything here is in the text's own box coordinates (0,0 = top-left of its box), the same ones
   the outlines are drawn in; objXf (05-svg-export.js) and worldToBox (04c-path-edit.js) turn those
   into the page, including for turned and mirrored text.
   Indexes are positions in o.text (UTF-16 units, like a textarea's selectionStart).
   A text is either point text (no o.bw: it is as wide as its longest line, and only a line break starts a new line) or
   area text (o.bw = the width of its box: words wrap onto new lines to fit it, and the box is that wide whatever is in it).
   A wrapped line ends in a soft break: nothing in o.text marks it, so the next line starts at the very index the last one
   ends at, and the spaces where the text was cut stay at the end of the line they ended (hanging past the box, never drawn
   or counted when aligning). A line break in o.text is a hard break: the next line starts one index after it.
   ===================================================================== */

/* ---------- one line: where each character starts ---------- */
const lineMetricCache = new Map();
const noGlyph = () => {};
// xs[i] is where the caret sits before character i (and xs[n] after the last one); width is the line's advance.
// forEachGlyph is the very walk getPath and getAdvanceWidth make, so these positions are the drawn ones.
function measureLine(font, size, ls, line) {
  const opts = { kerning: true, letterSpacing: ls }, n = line.length, xs = [], walks = typeof font.forEachGlyph === 'function';
  let width = walks ? font.forEachGlyph(line, 0, 0, size, opts, (g, x) => { xs.push(x); }) : undefined;
  if (typeof width !== 'number') width = font.getAdvanceWidth(line, size, opts);
  if (xs.length !== n) {
    // A ligature (fi, say) is one glyph for several characters. Measure each prefix instead; for a very long line, spread evenly.
    xs.length = 0;
    for (let i = 0; i < n; i++) xs.push(!i ? 0 : walks && n <= 1500 ? font.forEachGlyph(line.slice(0, i), 0, 0, size, opts, noGlyph) : width * i / n);
  }
  xs.push(width);
  for (let i = 1; i < xs.length; i++) if (xs[i] < xs[i - 1]) xs[i] = xs[i - 1];   // never backwards
  return { width, xs };
}
function lineMetrics(font, fontKey, size, ls, line) {
  const key = fontKey + '|' + size + '|' + ls + '|' + line;
  let m = lineMetricCache.get(key);
  if (m) { lineMetricCache.delete(key); lineMetricCache.set(key, m); return m; }   // keep recently used ones
  m = measureLine(font, size, ls, line);
  lineMetricCache.set(key, m);
  if (lineMetricCache.size > 3000) lineMetricCache.delete(lineMetricCache.keys().next().value);
  return m;
}
// A face that was used before it arrived was measured in the default font (see fontArrived)
function purgeLineMetrics(fontKey) {
  Array.from(lineMetricCache.keys()).forEach(k => { if (k.startsWith(fontKey + '|')) lineMetricCache.delete(k); });
}

/* ---------- the whole text ---------- */
// A line with runs (04g-text-runs.js) is cut into segments wherever the face or size changes (a change of color alone
// does not move anything). Each segment is measured and drawn by itself, one after the other along the line.
function runLine(o, runs, t, start, textLen) {
  const ls = o.ls || 0, last = Math.max(textLen - 1, 0);
  const sl = t ? runSlices(runs, start, start + t.length) : [{ a: start, b: start, st: runStyleAt(runs, clamp(start, 0, last)) }];   // (an empty line takes the style of its break)
  const segs = [];
  let H = 0;
  sl.forEach(p => {
    const f = p.st.f !== undefined ? p.st.f : o.font, size = rnd(o.size * (p.st.s !== undefined ? p.st.s : 1), 3), sp = p.st.l !== undefined ? p.st.l : ls, prev = segs[segs.length - 1];
    H = Math.max(H, size * (p.st.h !== undefined ? p.st.h : o.lh));   // (the tallest letter sets the line's height)
    if (prev && prev.f === f && prev.size === size && prev.ls === sp) prev.b = p.b - start;
    else segs.push({ a: p.a - start, b: p.b - start, f, size, ls: sp });
  });
  const xs = [];
  let x = 0, A = 0, D = 0;
  segs.forEach(g => {
    g.font = fontOf(g.f);
    const m = lineMetrics(g.font, g.f, g.size, g.ls, t.slice(g.a, g.b)), sc = g.size / g.font.unitsPerEm;
    g.x = x;
    for (let j = 0; j < g.b - g.a; j++) xs.push(x + m.xs[j]);
    x += m.width;
    A = Math.max(A, g.font.ascender * sc); D = Math.max(D, -g.font.descender * sc);
  });
  xs.push(x);
  return { m: { width: x, xs }, segs, A, D, H };
}
/* ---------- wrapping ---------- */
// The characters a line may be cut after, and that hang at its end instead of counting toward its width
const isBreakSpace = c => c === ' ' || c === '\t' || c === '　' || (c >= ' ' && c <= ' ' && c !== ' ');
const isHyphenLike = c => c === '-' || c === '‐' || c === '–' || c === '—';
// Where one paragraph (t, with xs[i] = the x before character i, and xs[t.length] its end) is cut into lines for a box
// bw wide: the end index of each line, the last being t.length. A line is cut after a run of spaces, or after a hyphen or
// dash inside a word, as late as it still fits. A word too long for a line of its own is cut where the box is full
// (that is also how a text with no spaces, in Chinese for one, wraps). Every line has at least one character.
function breakLines(t, xs, bw) {
  const n = t.length, ends = [], eps = 1e-6;
  let a = 0;
  while (a < n) {
    let best = -1;
    for (let p = a + 1; p <= n; p++) {
      const chance = p === n || (isBreakSpace(t[p - 1]) && !isBreakSpace(t[p])) || (isHyphenLike(t[p - 1]) && p - 1 > a && !isBreakSpace(t[p]) && !isHyphenLike(t[p]));
      if (!chance) continue;
      let e = p;
      while (e > a && isBreakSpace(t[e - 1])) e--;   // (the spaces at the end of a line do not count)
      if (xs[e] - xs[a] <= bw + eps) best = p; else break;
    }
    if (best < 0) {
      best = a + 1;
      for (let p = a + 2; p <= n && xs[p] - xs[a] <= bw + eps; p++) best = p;
      while (best > a + 1 && best < n && (/[\uDC00-\uDFFF]/.test(t[best]) || /^\p{M}$/u.test(t[best]))) best--;   // (never inside a letter with its accent, or a pair of units)
    }
    ends.push(best);
    a = best;
  }
  return ends;
}
// The lines of one paragraph for a box bw wide: the end of each line within the paragraph
function wrapCuts(o, runs, text, para, ps, bw) {
  if (!para.length) return [0];
  const m = runs ? runLine(o, runs, para, ps, text.length).m : lineMetrics(fontOf(o.font), o.font, o.size, o.ls || 0, para);
  return breakLines(para, m.xs, bw);
}

// lines[i]: { i, text, start, end (indexes of its first character and just past its last), m: its metrics,
//             x (left edge, from the alignment), top (its slot), h (its height), asc, desc, base (its baseline),
//             hard (it ends at a line break or the end of the text, not at a wrap),
//             tw (its width without the spaces hanging at its end: what is aligned; point text counts them),
//             cend (the last index the caret can sit at on this line: just after the last word of a wrapped line, so
//                   the caret does not jump to the next line),
//             segs: [{ a, b (characters of the line), f (face), font, size, ls (letter spacing), x (from the line's left edge) }] }
// lay.flat: no runs, so every line is the same height and sits at i * lineH
// lay.area: wrapped to a box (o.bw); lay.w is then that width
function textLayout(o) {
  const text = String(o.text), runs = Array.isArray(o.runs) && o.runs.length ? o.runs : null, bw = o.bw > 0 ? o.bw : 0;
  const font = fontOf(o.font), size = o.size, scale = size / font.unitsPerEm;
  const asc = font.ascender * scale, desc = -font.descender * scale;
  const lineH = size * o.lh, ls = o.ls || 0;
  let W = bw || size * 0.4, acc = 0, ps = 0;
  const pieces = [];   // the text cut into the pieces laid out one to a line
  text.split('\n').forEach(para => {
    const cuts = bw ? wrapCuts(o, runs, text, para, ps, bw) : [para.length];
    let a = 0;
    cuts.forEach((b, k) => { pieces.push({ t: para.slice(a, b), start: ps + a, hard: k === cuts.length - 1 }); a = b; });
    ps += para.length + 1;   // (the line break counts as a character)
  });
  const lines = pieces.map((pc, i) => {
    const t = pc.t, start = pc.start;
    let r;
    if (runs) r = runLine(o, runs, t, start, text.length);
    else {
      const m = lineMetrics(font, o.font, size, ls, t);
      r = { m, segs: [{ a: 0, b: t.length, f: o.font, font, size, ls, x: 0 }], A: asc, D: desc };
    }
    let te = t.length;
    if (bw) while (te > 0 && isBreakSpace(t[te - 1])) te--;
    const tw = bw ? r.m.xs[te] : r.m.width;
    if (!bw && r.m.width > W) W = r.m.width;
    const h = runs ? r.H : lineH, top = runs ? acc : i * lineH;
    const L = { i, text: t, start, end: start + t.length, m: r.m, segs: r.segs, x: 0, top, h, asc: r.A, desc: r.D, base: top + (h - (r.A + r.D)) / 2 + r.A,
      hard: pc.hard, tw, cend: pc.hard ? start + t.length : start + te < start + t.length ? start + te : start + t.length };
    acc += h;
    return L;
  });
  lines.forEach(L => { L.x = o.align === 'center' ? (W - L.tw) / 2 : o.align === 'right' ? W - L.tw : 0; });
  return { font, size, asc, desc, lineH, ls, lines, w: W, h: runs ? acc : lineH * lines.length, flat: !runs, area: !!bw };
}

/* ---------- caret, selection, and clicks ---------- */
// The line at a height (box coordinates): the nearest one, above the first or below the last
function lineAtY(lay, y) {
  const ls = lay.lines;
  if (lay.flat) return ls[lay.lineH > 0 ? clamp(Math.floor(y / lay.lineH), 0, ls.length - 1) : 0];
  let lo = 0, hi = ls.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ls[mid].top <= y) lo = mid; else hi = mid - 1; }
  return ls[lo];
}
// The line an index is on (an index at the very end of a line is on that line, not the next; but where a line is wrapped, that index is
// also the start of the next line, and is on the next one)
function lineOfIndex(lay, index) {
  const ls = lay.lines;
  let lo = 0, hi = ls.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ls[mid].start <= index) lo = mid; else hi = mid - 1; }
  return ls[lo];
}
// Where the caret is drawn for an index: a vertical segment from the font's top to its bottom
function caretAt(lay, index) {
  const L = lineOfIndex(lay, index), col = clamp(index - L.start, 0, L.text.length);
  return { x: L.x + L.m.xs[col], y0: L.base - L.asc, y1: L.base + L.desc, line: L.i };
}
// The highlight for a selection from a to b: a rectangle per line. A selection that runs past the end of a line (a line break, not a wrap) also covers its break.
function selectionRects(lay, a, b) {
  if (a > b) { const t = a; a = b; b = t; }
  const out = [], brk = Math.max(lay.size * 0.25, 2);
  lay.lines.forEach(L => {
    const s = Math.max(a, L.start), e = Math.min(b, L.end);
    if (s > e) return;
    const x0 = L.x + L.m.xs[s - L.start], x1 = L.x + L.m.xs[e - L.start] + (b > L.end && L.hard && L.i < lay.lines.length - 1 ? brk : 0);
    if (x1 > x0) out.push({ x: x0, y: L.base - L.asc, w: x1 - x0, h: L.asc + L.desc });
  });
  return out;
}
// The index nearest a point (box coordinates): the line by height, then the closest gap between letters
function indexAtPoint(lay, x, y) {
  const L = lineAtY(lay, y), xs = L.m.xs, n = L.text.length, lx = x - L.x;
  if (lx <= xs[0]) return L.start;
  if (lx >= xs[n]) return L.cend;
  let lo = 0, hi = n;   // xs[lo] <= lx < xs[hi]
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= lx) lo = mid; else hi = mid; }
  let col = lx - xs[lo] < xs[hi] - lx ? lo : hi;
  if (!L.hard) col = Math.min(col, L.cend - L.start);   // (a wrapped line's end is also the start of the next: stay on this one)
  if (col > 0 && col < n) {   // never between the two halves of one character
    const c1 = L.text.charCodeAt(col - 1), c2 = L.text.charCodeAt(col);
    if (c1 >= 0xD800 && c1 <= 0xDBFF && c2 >= 0xDC00 && c2 <= 0xDFFF) col--;
  }
  return L.start + col;
}
// Up (dir -1) or Down (+1) from an index, keeping to goalX (the column the caret started from; null = where it is now).
// Up from the first line goes to the start, Down from the last to the end.
function verticalMove(lay, index, dir, goalX) {
  const L = lineOfIndex(lay, index), gx = goalX === null || goalX === undefined ? caretAt(lay, index).x : goalX, j = L.i + dir;
  if (j < 0) return { index: 0, goalX: gx };
  if (j >= lay.lines.length) return { index: lay.lines[lay.lines.length - 1].end, goalX: gx };
  return { index: indexAtPoint(lay, gx, lay.lines[j].top + lay.lines[j].h / 2), goalX: gx };
}
// The word at an index, for double-click: a run of letters and digits, of spaces, or of other marks, within one line
function wordRange(text, index) {
  const n = text.length;
  index = clamp(index, 0, n);
  const i = index < n && text[index] !== '\n' ? index : index - 1;   // at the end of a line, the one before
  if (i < 0 || text[i] === '\n') return [index, index];
  const kind = c => /[\p{L}\p{N}\p{M}_]/u.test(c) ? 'w' : /\s/.test(c) ? 's' : 'p', k = kind(text[i]);
  let s = i, e = i + 1;
  while (s > 0 && text[s - 1] !== '\n' && kind(text[s - 1]) === k) s--;
  while (e < n && text[e] !== '\n' && kind(text[e]) === k) e++;
  return [s, e];
}
// The whole line at an index, for triple-click
function lineRange(text, index) {
  index = clamp(index, 0, text.length);
  const s = index > 0 ? text.lastIndexOf('\n', index - 1) + 1 : 0, e = text.indexOf('\n', index);
  return [s, e < 0 ? text.length : e];
}

/* ---------- picking text by its box ---------- */
// True when a page point {x, y} is inside an object's box (turned and mirrored with the object), padded by pad
function boxContains(o, p, pad) {
  const q = worldToBox(o, p.x, p.y), e = pad || 0;
  return q[0] >= -e && q[0] <= o.w + e && q[1] >= -e && q[1] <= o.h + e;
}
// A selected text can be picked anywhere in its box, not only on its letters, so the space between and
// around them is not a dead zone. It only wins over what is under it: `under` is what the click hit
// (null for nothing), and anything drawn above the text still gets the click first.
function textBoxAt(p, under) {
  for (let i = doc.objects.length - 1; i > (under ? doc.objects.indexOf(under) : -1); i--) {
    const o = doc.objects[i];
    if (o.kind === 'text' && S.sel.has(o.id) && !isLocked(o) && !isHidden(o) && boxContains(o, p)) return o;
  }
  return null;
}
