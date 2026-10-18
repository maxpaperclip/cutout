/* =====================================================================
   Text layout with positions (no DOM; unit tested)
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
   Three typographic options work on area text (they need a box to work against):
   - o.align === 'justify': every line but the last of a paragraph has its spaces stretched until it is exactly as wide as the box.
     The stretched positions go into the line's metrics (L.m.xs), so the caret and clicks agree with the drawing, which is cut
     into words (L.slots says where) because the spaces are no longer the width the font gave them.
   - o.pspace (in ems; point text too): extra room before every paragraph but the first, on top of the line height.
   - o.indent (in ems): the first line of every paragraph, that is after a line break and at the start, starts that far in; with
     o.noind1 the very first paragraph of the text is left out (as under a heading, in a book).
   - o.hyph: a word may be broken inside, after the letters hyphenPoints (04h-hyphenation.js) allows. The hyphen that ends such a line
     is not in o.text; it belongs to the layout (L.hy), is drawn by buildText and takes no part in editing.
   - a drop cap (area text; o.paras, 04k-text-paragraphs.js): the first letters of a paragraph are one big capital N lines tall, drawn on its own
     (lay.caps); the first N rows of the paragraph start after it. Its letters are in o.text like any other, but are in no line.
   - o.hang (optical margin alignment): an opening quote at the start of a line, and a closing quote or a hyphen at the end of one, hang
     out into the margin so the letters line up (L.hl, L.hr = how far). true hangs them the whole of their width; a number is how much of
     it (0.5 = half; see hangFactor). Text with no box hangs too, but nothing wraps differently.
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

/* ---------- drop caps ---------- */
// How tall the capital letters of a face are, as a fraction of its size: from the face's own figure, or else measured on an H
const capRatioCache = new WeakMap();
function capRatioOf(font) {
  let r = capRatioCache.get(font);
  if (r) return r;
  const os2 = font.tables && font.tables.os2;
  if (os2 && os2.sCapHeight > 0) r = os2.sCapHeight / (font.unitsPerEm || 1000);
  else {
    try { const bb = font.charToGlyph('H').getBoundingBox(); if (bb && bb.y2 > 0) r = bb.y2 / (font.unitsPerEm || 1000); } catch (e) { /* no glyph to measure */ }
  }
  if (!(r > 0.2 && r < 1.2)) r = 0.7;
  capRatioCache.set(font, r);
  return r;
}
// How far a letter's ink starts from where it is drawn (its left side bearing), at a size: lined up with the margin, a big letter
// would otherwise start a little in, and by a different amount for each letter
function glyphLsb(font, ch, size) {
  try { const bb = font.charToGlyph(ch).getBoundingBox(); if (bb && Number.isFinite(bb.x1) && bb.x2 > bb.x1) return bb.x1 * size / (font.unitsPerEm || 1000); } catch (e) { /* none */ }
  return 0;
}
// How much of the start of a paragraph a drop cap of dn letters takes (a letter keeps its accents, and a pair of units stays whole)
function capLength(para, dn) {
  let i = 0;
  for (let k = 0; k < dn && i < para.length; k++) {
    i += para.codePointAt(i) > 0xFFFF ? 2 : 1;
    while (i < para.length && /^\p{M}$/u.test(para[i])) i++;
  }
  return i;
}
// The drop cap of the paragraph that starts at index ps, N lines tall, made of dn letters: its letters, face and size, how far the
// lines beside it are held in (inset), and how far apart the lines of the paragraph are (pitch). The size is worked out, not chosen:
// the top of the capital is level with the tops of the capitals on the first line, and its baseline is the baseline of line N.
function dropCapSpec(o, runs, text, para, ps, N, dn, bw, minSlot) {
  const n = capLength(para, dn), ctext = para.slice(0, n), last = Math.max(text.length - 1, 0);
  const cst = runs ? runStyleAt(runs, ps) : {}, bst = runs ? runStyleAt(runs, Math.min(ps + n, last)) : {};
  const f = cst.f !== undefined ? cst.f : o.font, cfont = fontOf(f), bfont = fontOf(bst.f !== undefined ? bst.f : o.font);
  const bsize = rnd(o.size * (bst.s !== undefined ? bst.s : 1), 3), pitch = bsize * (bst.h !== undefined ? bst.h : o.lh);
  const ls = cst.l !== undefined ? cst.l : (o.ls || 0);
  const size = rnd(((N - 1) * pitch + capRatioOf(bfont) * bsize) / capRatioOf(cfont), 3);
  const m = lineMetrics(cfont, f, size, ls, ctext), lsb = glyphLsb(cfont, String.fromCodePoint(ctext.codePointAt(0)), size);
  const inset = Math.min(Math.max(m.width - lsb, 0) + size * 0.08, Math.max(0, bw - minSlot));
  return { n, text: ctext, f, font: cfont, size, ls, lsb, m, inset, pitch, c: cst.c, N };
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
// The marks that hang out into the margin (optical margin alignment): opening quotes at the start of a line, closing quotes
// and hyphens at the end of one. Dashes longer than a hyphen are left in place: hanging them looks like a mistake.
const HANG_START = new Set(['"', "'", '“', '‘', '„', '‚', '«', '‹']);
const HANG_END = new Set(['"', "'", '”', '’', '»', '›', '-', '‐', '–']);
// How much of its width a hanging mark hangs: 0 (nothing hangs) up to HANG_MAX; o.hang === true means all of it
const HANG_MAX = 1.5;
const hangFactor = o => o.hang === true ? 1 : o.hang > 0 ? Math.min(+o.hang, HANG_MAX) : 0;
// How far the first and the last mark of a piece of text (t[a..e), xs as for breakLines) hang. hyw: the width of the hyphen the
// layout adds at the end (it always hangs). The two never hang the same mark. f: how much of each mark's width (1 = all of it)
function hangOf(t, xs, a, e, hyw, f) {
  const k = f === undefined ? 1 : f;
  const l = a < e && HANG_START.has(t[a]) ? (xs[a + 1] - xs[a]) * k : 0;
  const r = hyw ? hyw * k : e - 1 > a && HANG_END.has(t[e - 1]) ? (xs[e] - xs[e - 1]) * k : 0;
  return { l, r };
}
// Where one paragraph (t, with xs[i] = the x before character i, and xs[t.length] its end) is cut into lines for a box
// bw wide: [{ end, hy }], the end index of each line (the last being t.length) and whether a hyphen is added after it (hy = its width).
// A line is cut after a run of spaces, or after a hyphen or dash inside a word, as late as it still fits; with opt.hy
// (a Map: index -> width of the hyphen that would be added) also inside a word at those places. With opt.hang the marks
// that hang out into the margin do not count toward the width. A word too long for a line of its own is cut where the box is full
// (that is also how a text with no spaces, in Chinese for one, wraps). Every line has at least one character.
function breakAt(t, xs, a, bw, hy, hang, bwFull) {
  const n = t.length, eps = 1e-6;
  let best = -1, bestHy = 0, firstWd = -1;
  for (let p = a + 1; p <= n; p++) {
    const hw = hy && p < n ? hy.get(p) || 0 : 0;
    const chance = hw > 0 || p === n || (isBreakSpace(t[p - 1]) && !isBreakSpace(t[p])) || (isHyphenLike(t[p - 1]) && p - 1 > a && !isBreakSpace(t[p]) && !isHyphenLike(t[p]));
    if (!chance) continue;
    let e = p;
    while (e > a && isBreakSpace(t[e - 1])) e--;   // (the spaces at the end of a line do not count)
    let wd = xs[e] - xs[a] + hw;
    if (hang) { const h = hangOf(t, xs, a, e, hw, hang); wd -= h.l + h.r; }
    if (firstWd < 0) firstWd = wd;
    if (wd <= bw + eps) { best = p; bestHy = hw; } else break;
  }
  if (best < 0) {
    // A slot narrower than the box (beside a shape) that cannot hold the next word is left empty rather than cutting the word
    if (bwFull !== undefined && bw < bwFull - eps && firstWd <= bwFull + eps) return null;
    best = a + 1; bestHy = 0;
    for (let p = a + 2; p <= n && xs[p] - xs[a] <= bw + eps; p++) best = p;
    while (best > a + 1 && best < n && (/[\uDC00-\uDFFF]/.test(t[best]) || /^\p{M}$/u.test(t[best]))) best--;   // (never inside a letter with its accent, or a pair of units)
  }
  return { end: best, hy: bestHy };
}
function breakLinesEx(t, xs, bw, opt) {
  const n = t.length, out = [], hy = opt && opt.hy, hang = opt && opt.hang ? (opt.hang === true ? 1 : opt.hang) : 0;
  let a = 0;
  while (a < n) { const c = breakAt(t, xs, a, bw, hy, hang); out.push(c); a = c.end; }
  return out;
}
const breakLines = (t, xs, bw) => breakLinesEx(t, xs, bw).map(c => c.end);

// The hyphen a line gets when it is cut inside a word: the face, size and spacing of the letter before it, and how wide it is
function hyphenSpec(o, runs, idx) {
  const st = runs ? runStyleAt(runs, idx) : {}, f = st.f !== undefined ? st.f : o.font, size = rnd(o.size * (st.s !== undefined ? st.s : 1), 3), ls = st.l !== undefined ? st.l : (o.ls || 0);
  return { f, size, ls, font: fontOf(f), w: lineMetrics(fontOf(f), f, size, ls, '-').width };
}
// The places in a paragraph where a word may be broken with a hyphen: Map index -> hyphen spec. Only whole words of plain English letters
// (a word touching an accented letter, a digit or an apostrophe is left alone).
function hyphenPlaces(o, runs, para, ps) {
  const out = new Map(), re = /[A-Za-z]+/g;
  let m;
  while ((m = re.exec(para))) {
    const before = m.index > 0 ? para[m.index - 1] : '', after = para[m.index + m[0].length] || '';
    if (/[\p{L}\p{M}\p{N}'’_]/u.test(before) || /[\p{L}\p{M}\p{N}'’_]/u.test(after)) continue;
    hyphenPoints(m[0]).forEach(k => { const at = m.index + k; out.set(at, hyphenSpec(o, runs, ps + at - 1)); });
  }
  return out;
}
// What is needed to cut one paragraph into lines of any width: its character positions, where it may be hyphenated, the hang
function wrapSetup(o, runs, text, para, ps) {
  const m = runs ? runLine(o, runs, para, ps, text.length).m : lineMetrics(fontOf(o.font), o.font, o.size, o.ls || 0, para);
  const places = o.hyph ? hyphenPlaces(o, runs, para, ps) : null;
  return { para, xs: m.xs, places, hyw: places ? new Map(Array.from(places, ([k, v]) => [k, v.w])) : null, hang: hangFactor(o) };
}
// The next line of a paragraph from index a, for a slot of width w (bwFull = the box; a narrower slot may be skipped): { end, hy (spec) } or null
function takeLine(su, a, w, bwFull) {
  const c = breakAt(su.para, su.xs, a, w, su.hyw, su.hang, bwFull);
  return c ? { end: c.end, hy: c.hy ? su.places.get(c.end) : null } : null;
}
// The lines of one paragraph for a box bw wide: [{ end, hy }] (end within the paragraph; hy = the hyphen spec added after it, or null)
function wrapPlan(o, runs, text, para, ps, bw) {
  if (!para.length) return [{ end: 0, hy: null }];
  const su = wrapSetup(o, runs, text, para, ps), out = [];
  let a = 0;
  while (a < para.length) { const c = takeLine(su, a, bw); out.push(c); a = c.end; }
  return out;
}
const wrapCuts = (o, runs, text, para, ps, bw) => wrapPlan(o, runs, text, para, ps, bw).map(c => c.end);

// lines[i]: { i, text, start, end (indexes of its first character and just past its last), m: its metrics,
//             x (left edge, from the alignment), top (its row), h (its height), asc, desc, base (its baseline),
//             hard (it ends at a line break or the end of the text, not at a wrap),
//             tw (its width without the spaces hanging at its end, and without the marks that hang into the margin, plus the
//                 hyphen it ends with: what is aligned; point text counts the spaces),
//             hl, hr (how far a mark hangs out past the left / right edge of tw; 0 unless o.hang),
//             hy ({ x (where it starts in the line), font, size, ls } the hyphen drawn at the end of a line cut inside a word, or null),
//             slots (justified lines: the columns of the spaces that were stretched, else null), gap (how much each grew),
//             cend (the last index the caret can sit at on this line: just after the last word of a wrapped line, so
//                   the caret does not jump to the next line),
//             row (which row of the text it is on), sx, sw (the stretch of the row it is laid out in: all of the box, unless a shape
//                   it wraps around is in the way, which cuts a row into pieces that the text fills one after the other; so
//                   several lines can share a row, in reading order),
//             segs: [{ a, b (characters of the line), f (face), font, size, ls (letter spacing), x (from the line's left edge) }] }
// lay.flat: no runs, and one line to a row, so every line is the same height and sits at i * lineH
// lay.area: wrapped to a box (o.bw); lay.w is then that width
// lay.ncols, cw, gut, colLines: columns (o.cols): how many, how wide, the space between, and the lines of each ([] when there is one). Each line has its
//          col, and its top is measured from the top of the box; so tops do not only go down in reading order. Column k starts at x = k * (cw + gut)
// lay.caps: the drop caps ([{ p (its paragraph), i0, i1 (the letters it is made of: not in any line), text, font, size, ls, c (its color, if
//           it has one of its own), x (where it is drawn from), ox (that, and where each letter starts), xs (where the caret goes: the
//           first is the start of the ink), x0 (the start of the ink), w, base, top, bottom, line (the first line beside it) }]
//           Its paragraph's lines start at i1. See dropCapSpec.
// obs: the shapes the text wraps around (wrapObstacles, in 04i-text-wrap.js); left out, they are looked up
function textLayout(o, obs) {
  const text = String(o.text), runs = Array.isArray(o.runs) && o.runs.length ? o.runs : null, bw = o.bw > 0 ? o.bw : 0;
  const font = fontOf(o.font), size = o.size, scale = size / font.unitsPerEm;
  const asc = font.ascender * scale, desc = -font.descender * scale;
  const lineH = size * o.lh, ls = o.ls || 0;
  let W = bw || size * 0.4;
  const pgap = o.pspace > 0 ? Math.min(+o.pspace, 10) * size : 0;   // the room between one paragraph and the next (o.pspace, in ems)
  const wraps0 = bw ? (obs === undefined ? wrapObstacles(o) : obs) : [];
  // A row's slots are chosen for the tallest line it could hold: with letters of different sizes the height is not known until the line is made
  let hEst = lineH;
  if (runs) runs.forEach(r => { const st = runStyle(r); hEst = Math.max(hEst, size * (st.s !== undefined ? st.s : 1) * (st.h !== undefined ? st.h : o.lh)); });
  const minSlot = Math.min(bw, Math.max(size, 8));
  // Columns (o.cols; o.gut, the space between them, in px like a page's own; area text only): the text flows down the first column, then the next. As many as fit (each at least cw0 wide).
  // With no height of its own the columns are balanced: the shortest height that holds the text (see below)
  const wantCols = bw ? clamp(Math.floor(+o.cols) || 1, 1, 6) : 1, gut = wantCols > 1 ? clamp(o.gut !== undefined ? +o.gut || 0 : GRID_DEFAULTS.baseline.size, 0, 400) : 0, cw0 = Math.max(size * 2, 8);
  let ncols = wantCols;
  while (ncols > 1 && (bw - (ncols - 1) * gut) / ncols < cw0) ncols--;
  const cw = ncols > 1 ? (bw - (ncols - 1) * gut) / ncols : bw;
  // The first line of every paragraph starts this far in (area text only; o.indent is in ems)
  const indent = bw && o.indent > 0 ? Math.min(+o.indent * size, Math.max(0, cw - minSlot)) : 0;
  // One line, laid out but not yet placed: t is its text, start its index, hy the hyphen it ends with, hard whether a line break ends it
  const makeLine = (t, start, hard, hyph, sx, sw) => {
    let r;
    if (runs) r = runLine(o, runs, t, start, text.length);
    else {
      const m = lineMetrics(font, o.font, size, ls, t);
      r = { m, segs: [{ a: 0, b: t.length, f: o.font, font, size, ls, x: 0 }], A: asc, D: desc };
    }
    let te = t.length;
    if (bw) while (te > 0 && isBreakSpace(t[te - 1])) te--;
    let m = r.m, hy = null, slots = null, gap = 0;
    const hang = hangFactor(o), hw = hyph ? hyph.w : 0, hg = hang ? hangOf(t, m.xs, 0, te, hw, hang) : { l: 0, r: 0 };
    let tw = (bw ? m.xs[te] : m.width) + hw - hg.l - hg.r;
    if (o.align === 'justify' && bw > 0 && !hard) {   // stretch the spaces between words until the line (less what hangs) is as wide as its slot
      let f0 = 0;
      while (f0 < te && isBreakSpace(t[f0])) f0++;
      const cols = [];
      for (let c = f0 + 1; c < te; c++) if (isBreakSpace(t[c])) cols.push(c);
      if (cols.length && sw > tw) {
        gap = (sw - tw) / cols.length;
        const xs = m.xs.slice();
        let k = 0;
        for (let c = 0; c < xs.length; c++) { while (k < cols.length && cols[k] < c) k++; xs[c] += gap * k; }
        m = { width: xs[xs.length - 1], xs };
        slots = cols;
        tw = sw;
      }
    }
    if (hyph) hy = { x: m.xs[te], font: hyph.font, size: hyph.size, ls: hyph.ls, f: hyph.f };
    if (!bw && tw > W) W = tw;
    return { i: 0, text: t, start, end: start + t.length, m, segs: r.segs, x: 0, top: 0, h: runs ? r.H : lineH, asc: r.A, desc: r.D, base: 0,
      hard, tw, hl: hg.l, hr: hg.r, hy, slots, gap, row: 0, sx, sw,
      cend: hard ? start + t.length : start + te < start + t.length ? start + te : start + t.length };
  };
  // The whole layout, with no column taller than Hlim (Infinity: no limit). over: the last column had to run past it
  const pass = Hlim => {
    const lines = [], caps = [], colBot = [0];
    let ps = 0, rowIdx = 0, rowTop = 0, blank = 0, yOff = 0, wraps = wraps0, col = 0, colBase = 0, colRows = 0, over = false;
    const flowY = () => (runs ? rowTop : rowIdx * lineH) + yOff;   // (how far down the text has come, all the columns end to end)
    const nextColumn = () => { col++; colBase = flowY(); colRows = 0; colBot[col] = 0; };
    // Put the lines of one row where they go: all on one baseline, as high as the tallest
    const placeRow = row => {
      const h = Math.max(...row.map(L => L.h)), A = Math.max(...row.map(L => L.asc)), D = Math.max(...row.map(L => L.desc));
      const top = flowY() - colBase;
      row.forEach(L => { L.top = top; L.h = row.length > 1 ? h : L.h; L.asc = row.length > 1 ? A : L.asc; L.desc = row.length > 1 ? D : L.desc; L.row = rowIdx; L.col = col; L.i = lines.length; L.base = top + (L.h - (L.asc + L.desc)) / 2 + L.asc; lines.push(L); });
      colBot[col] = Math.max(colBot[col], top + h);
      colRows++;
      if (runs) rowTop += h;
      rowIdx++;
    };
    const nextEmptyRow = () => { if (runs) rowTop += hEst; rowIdx++; colRows++; if (++blank > 4000) wraps = []; };   // (a row with no room in it: leave it empty; the cap only guards against shapes that never end)
    text.split('\n').forEach((para, pi) => {
      if (pi) yOff += pgap;   // (every line break starts a paragraph, an empty one too)
      // A drop cap (o.paras, see 04k-text-paragraphs.js; area text only): its letters leave the paragraph and are drawn on their own, and the
      // first N rows of the paragraph start after its width. The paragraph then is laid out from where its letters end: body, starting at bs.
      const dcs = bw && para.length ? paraSettingsAt(o.paras, pi) : null, dcN = dcs && dcs.dc >= 2 ? dcs.dc : 0;
      const cap = dcN ? dropCapSpec(o, runs, text, para, ps, dcN, dcs.dn || 1, cw, minSlot) : null;
      if (cap && colRows > 0 && col < ncols - 1 && flowY() - colBase + dcN * lineH > Hlim + 0.01) nextColumn();   // (a drop cap is not split between columns)
      const body = cap ? para.slice(cap.n) : para, bs = cap ? ps + cap.n : ps;
      const su = bw ? wrapSetup(o, runs, text, body, bs) : null;
      let a = 0, capRow = -1, capX = 0, capLine = -1;
      for (;;) {   // one row at a time until the paragraph is used up (an empty paragraph is one empty line)
        const top = flowY() - colBase, cx = col * (cw + gut), a0 = a;
        let free0 = !wraps.length ? [[cx, cx + cw]] : wrapFree(wraps, bw, top, top + hEst, minSlot);
        if (ncols > 1 && wraps.length) free0 = free0.map(sl => [Math.max(sl[0], cx), Math.min(sl[1], cx + cw)]).filter(sl => sl[1] - sl[0] >= minSlot);
        const inDrop = !!cap && (capRow < 0 || rowIdx < capRow + dcN);   // (the first row that has a line, and the rows below it as far as the cap goes)
        if (inDrop && capRow < 0 && free0.length) capX = free0[0][0];   // (the cap is at the left of the first stretch the text has)
        const free = inDrop ? free0.map((sl, k) => k ? sl : [sl[0] + cap.inset, sl[1]]).filter(sl => sl[1] - sl[0] >= minSlot) : free0;
        const row = [];
        if (!bw) row.push(makeLine(para, ps, true, null, 0, 0));
        else if (!body.length) { if (free.length) row.push(makeLine('', bs, true, null, free[0][0], free[0][1] - free[0][0])); }
        else free.forEach(sl => {
          if (a >= body.length) return;
          const ind = a === 0 && !cap && !(o.noind1 && ps === 0) ? indent : 0;   // (only the first line of the paragraph is indented, and not the very first one when o.noind1 says so; a drop cap is the indent)
          const c = takeLine(su, a, sl[1] - sl[0] - ind, cw - ind - (inDrop ? cap.inset : 0));
          if (!c) return;
          row.push(makeLine(body.slice(a, c.end), bs + a, c.end >= body.length, c.hy, sl[0] + ind, sl[1] - sl[0] - ind));
          a = c.end;
        });
        if (!row.length) { nextEmptyRow(); continue; }
        if (ncols > 1 && top + Math.max(...row.map(L => L.h)) > Hlim + 0.01) {   // (this row does not fit under the limit: it starts the next column, unless it is the first in its column)
          if (colRows > 0 && col < ncols - 1 && !(cap && capRow >= 0 && rowIdx < capRow + dcN)) { a = a0; nextColumn(); continue; }
          if (colRows > 0 && col === ncols - 1) over = true;
        }
        if (cap && capRow < 0) { capRow = rowIdx; capLine = lines.length; }
        placeRow(row);
        if (!bw || a >= body.length) break;
      }
      if (cap) {
        while (rowIdx < capRow + dcN) { if (runs) rowTop += hEst; rowIdx++; }   // (a paragraph shorter than its cap still leaves room for all of it)
        const base = lines[capLine].base + (dcN - 1) * cap.pitch, dx = capX - cap.lsb;
        caps.push({
          p: pi, i0: ps, i1: ps + cap.n, text: cap.text, f: cap.f, font: cap.font, size: cap.size, ls: cap.ls, c: cap.c,
          x: dx, base, w: cap.m.width, x0: capX, ox: cap.m.xs.map(v => dx + v), xs: cap.m.xs.map((v, k) => k ? dx + v : capX),   // (drawn from x; the caret sits at xs, which starts at the ink)
          top: base - capRatioOf(cap.font) * cap.size, bottom: base, line: capLine
        });
      }
      ps += para.length + 1;   // (the line break counts as a character)
    });
    return { lines, caps, over, acc: ncols > 1 ? Math.max(...colBot) : flowY() };
  };
  let r = pass(Infinity);
  if (ncols > 1) {   // Balanced columns: the smallest height that does not push the text out of the last column (found by halving; the text is laid out afresh at each try)
    let lo = Math.max(0, r.acc / ncols - lineH), hi = r.acc;
    for (let it = 0; it < 12 && hi - lo > Math.max(0.5, lineH * 0.2); it++) {
      const mid = (lo + hi) / 2, t = pass(mid);
      if (t.over) lo = mid; else { hi = mid; r = t; }
    }
  }
  const { lines, caps } = r, acc = r.acc;
  lines.forEach(L => {
    const sw = L.sw || W;
    L.x = L.sx + (o.align === 'center' ? (sw - L.tw) / 2 : o.align === 'right' ? sw - L.tw : 0) - L.hl;
    if (!L.sw) L.sw = W;
  });
  const colLines = ncols > 1 ? Array.from({ length: ncols }, (_, k) => lines.filter(L => L.col === k)) : null;
  return { font, size, asc, desc, lineH, ls, lines, caps, w: W, h: acc, flat: ncols === 1 && !runs && !pgap && lines.every((L, i) => L.row === i), area: !!bw,
    ncols, cw, gut, colLines };
}

/* ---------- caret, selection, and clicks ---------- */
// The line at a height (box coordinates): the nearest one, above the first or below the last. Where a shape cuts a row into
// several lines, the one nearest x (when it is given)
function lineAtY(lay, y, x) {
  let ls = lay.lines;
  if (lay.colLines) {   // (columns: the column by x, the nearest one that has lines in it, then the line by y within it)
    const c = clamp(Math.floor(((x === undefined ? 0 : x) + lay.gut / 2) / (lay.cw + lay.gut)), 0, lay.ncols - 1);
    let best = -1;
    lay.colLines.forEach((cl, k) => { if (cl.length && (best < 0 || Math.abs(k - c) < Math.abs(best - c))) best = k; });
    ls = lay.colLines[best];
  }
  if (lay.flat) return ls[lay.lineH > 0 ? clamp(Math.floor(y / lay.lineH), 0, ls.length - 1) : 0];
  let lo = 0, hi = ls.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ls[mid].top <= y) lo = mid; else hi = mid - 1; }
  let s = lo;
  while (s > 0 && ls[s - 1].top === ls[lo].top) s--;
  if (s === lo || x === undefined) return ls[s];
  let best = ls[s], bd = Infinity;
  for (let k = s; k <= lo; k++) {
    const L = ls[k], d = x < L.sx ? L.sx - x : x > L.sx + L.sw ? x - (L.sx + L.sw) : 0;
    if (d < bd) { bd = d; best = L; }
  }
  return best;
}
// The line an index is on (an index at the very end of a line is on that line, not the next; but where a line is wrapped, that index is
// also the start of the next line, and is on the next one)
const capAt = (lay, index) => lay.caps && lay.caps.find(c => index >= c.i0 && index < c.i1);   // the drop cap an index is one of the letters of, if any
function lineOfIndex(lay, index) {
  const ls = lay.lines, cap = capAt(lay, index);
  if (cap) return ls[cap.line];   // (a letter of a drop cap belongs to no line: the first one beside it stands in)
  let lo = 0, hi = ls.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ls[mid].start <= index) lo = mid; else hi = mid - 1; }
  return ls[lo];
}
// Where the caret is drawn for an index: a vertical segment from the font's top to its bottom
function caretAt(lay, index) {
  const cap = capAt(lay, index);
  if (cap) return { x: cap.xs[index - cap.i0], y0: cap.top, y1: cap.bottom, line: cap.line };   // (as tall as the letter)
  const L = lineOfIndex(lay, index), col = clamp(index - L.start, 0, L.text.length);
  return { x: L.x + L.m.xs[col], y0: L.base - L.asc, y1: L.base + L.desc, line: L.i };
}
// The highlight for a selection from a to b: a rectangle per line. A selection that runs past the end of a line (a line break, not a wrap) also covers its break.
function selectionRects(lay, a, b) {
  if (a > b) { const t = a; a = b; b = t; }
  const out = [], brk = Math.max(lay.size * 0.25, 2);
  (lay.caps || []).forEach(c => {   // (the letters of a drop cap)
    const s = Math.max(a, c.i0), e = Math.min(b, c.i1);
    if (s < e) out.push({ x: c.xs[s - c.i0], y: c.top, w: c.xs[e - c.i0] - c.xs[s - c.i0], h: c.bottom - c.top });
  });
  lay.lines.forEach(L => {
    const s = Math.max(a, L.start), e = Math.min(b, L.end);
    if (s > e) return;
    const x0 = L.x + L.m.xs[s - L.start], x1 = L.x + L.m.xs[e - L.start] + (b > L.end && L.hard && L.i < lay.lines.length - 1 ? brk : 0);
    if (x1 > x0) out.push({ x: x0, y: L.base - L.asc, w: x1 - x0, h: L.asc + L.desc });
  });
  return out;
}
// The index nearest a point (box coordinates): the line by height, then the closest gap between letters
function indexAtPoint(lay, x, y, skipCaps) {
  for (const c of skipCaps ? [] : lay.caps || []) {   // a press on a drop cap, or beside it: the gap between its letters nearest, or before it
    if (y < c.top || y > c.bottom || x > c.x + c.w) continue;
    if (x <= c.x0) return c.i0;
    let k = 0;
    for (let j = 1; j < c.xs.length; j++) if (Math.abs(x - c.xs[j]) < Math.abs(x - c.xs[k])) k = j;
    return c.i0 + k;
  }
  const L = lineAtY(lay, y, x), xs = L.m.xs, n = L.text.length, lx = x - L.x;
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
// Where Home goes on a line: its start; on the first line beside a drop cap, in front of the cap
function lineHome(lay, L) {
  const c = lay.caps && lay.caps.find(k => k.line === L.i);
  return c ? c.i0 : L.start;
}
// Up (dir -1) or Down (+1) from an index, keeping to goalX (the column the caret started from; null = where it is now).
// Up from the first line goes to the start, Down from the last to the end.
function verticalMove(lay, index, dir, goalX) {
  const L = lineOfIndex(lay, index), gx = goalX === null || goalX === undefined ? caretAt(lay, index).x : goalX;
  let j = L.i + dir;
  while (j >= 0 && j < lay.lines.length && lay.lines[j].top === L.top && lay.lines[j].col === L.col) j += dir;   // (the lines beside this one, on the same row, are not above or below it)
  if (j < 0) return { index: 0, goalX: gx };
  if (j >= lay.lines.length) return { index: lay.lines[lay.lines.length - 1].end, goalX: gx };
  const M = lay.lines[j], shift = lay.ncols > 1 ? (M.col - L.col) * (lay.cw + lay.gut) : 0;   // (into another column: the same distance from its left edge)
  return { index: indexAtPoint(lay, gx + shift, M.top + M.h / 2, true), goalX: gx + shift };   // (the lines, not the drop cap that is beside them, or Down would never leave it)
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

/* ---------- the box of a text ---------- */
// True when a page point {x, y} is inside an object's box (turned and mirrored with the object), padded by pad. (A text is picked
// anywhere in its box: see the invisible rectangle syncObjects draws over it. This is for a press while typing in place.)
function boxContains(o, p, pad) {
  const q = worldToBox(o, p.x, p.y), e = pad || 0;
  return q[0] >= -e && q[0] <= o.w + e && q[1] >= -e && q[1] <= o.h + e;
}
