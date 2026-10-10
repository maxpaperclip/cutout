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
   Three typographic options work on area text (they need a box to work against):
   - o.align === 'justify': every line but the last of a paragraph has its spaces stretched until it is exactly as wide as the box.
     The stretched positions go into the line's metrics (L.m.xs), so the caret and clicks agree with the drawing, which is cut
     into words (L.slots says where) because the spaces are no longer the width the font gave them.
   - o.hyph: a word may be broken inside, after the letters hyphenPoints (04h-hyphenation.js) allows. The hyphen that ends such a line
     is not in o.text; it belongs to the layout (L.hy), is drawn by buildText and takes no part in editing.
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
// obs: the shapes the text wraps around (wrapObstacles, in 04i-text-wrap.js); left out, they are looked up
function textLayout(o, obs) {
  const text = String(o.text), runs = Array.isArray(o.runs) && o.runs.length ? o.runs : null, bw = o.bw > 0 ? o.bw : 0;
  const font = fontOf(o.font), size = o.size, scale = size / font.unitsPerEm;
  const asc = font.ascender * scale, desc = -font.descender * scale;
  const lineH = size * o.lh, ls = o.ls || 0;
  let W = bw || size * 0.4, acc = 0, ps = 0, rowIdx = 0, rowTop = 0, blank = 0;
  let wraps = bw ? (obs === undefined ? wrapObstacles(o) : obs) : [];
  // A row's slots are chosen for the tallest line it could hold: with letters of different sizes the height is not known until the line is made
  let hEst = lineH;
  if (runs) runs.forEach(r => { const st = runStyle(r); hEst = Math.max(hEst, size * (st.s !== undefined ? st.s : 1) * (st.h !== undefined ? st.h : o.lh)); });
  const minSlot = Math.min(bw, Math.max(size, 8));
  const lines = [];
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
  // Put the lines of one row where they go: all on one baseline, as high as the tallest
  const placeRow = row => {
    const h = Math.max(...row.map(L => L.h)), A = Math.max(...row.map(L => L.asc)), D = Math.max(...row.map(L => L.desc));
    const top = runs ? rowTop : rowIdx * lineH;
    row.forEach(L => { L.top = top; L.h = row.length > 1 ? h : L.h; L.asc = row.length > 1 ? A : L.asc; L.desc = row.length > 1 ? D : L.desc; L.row = rowIdx; L.i = lines.length; L.base = top + (L.h - (L.asc + L.desc)) / 2 + L.asc; lines.push(L); });
    if (runs) rowTop += h;
    rowIdx++;
  };
  const nextEmptyRow = () => { if (runs) rowTop += hEst; rowIdx++; if (++blank > 4000) wraps = []; };   // (a row with no room in it: leave it empty; the cap only guards against shapes that never end)
  text.split('\n').forEach(para => {
    const su = bw ? wrapSetup(o, runs, text, para, ps) : null;
    let a = 0;
    for (;;) {   // one row at a time until the paragraph is used up (an empty paragraph is one empty line)
      const top = runs ? rowTop : rowIdx * lineH;
      const free = !wraps.length ? [[0, bw]] : wrapFree(wraps, bw, top, top + hEst, minSlot);
      const row = [];
      if (!bw) row.push(makeLine(para, ps, true, null, 0, 0));
      else if (!para.length) { if (free.length) row.push(makeLine('', ps, true, null, free[0][0], free[0][1] - free[0][0])); }
      else free.forEach(sl => {
        if (a >= para.length) return;
        const c = takeLine(su, a, sl[1] - sl[0], bw);
        if (!c) return;
        row.push(makeLine(para.slice(a, c.end), ps + a, c.end >= para.length, c.hy, sl[0], sl[1] - sl[0]));
        a = c.end;
      });
      if (!row.length) { nextEmptyRow(); continue; }
      placeRow(row);
      if (!bw || a >= para.length) break;
    }
    ps += para.length + 1;   // (the line break counts as a character)
  });
  acc = runs ? rowTop : rowIdx * lineH;
  lines.forEach(L => {
    const sw = L.sw || W;
    L.x = L.sx + (o.align === 'center' ? (sw - L.tw) / 2 : o.align === 'right' ? sw - L.tw : 0) - L.hl;
    if (!L.sw) L.sw = W;
  });
  return { font, size, asc, desc, lineH, ls, lines, w: W, h: acc, flat: !runs && lines.every((L, i) => L.row === i), area: !!bw };
}

/* ---------- caret, selection, and clicks ---------- */
// The line at a height (box coordinates): the nearest one, above the first or below the last. Where a shape cuts a row into
// several lines, the one nearest x (when it is given)
function lineAtY(lay, y, x) {
  const ls = lay.lines;
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
// Up (dir -1) or Down (+1) from an index, keeping to goalX (the column the caret started from; null = where it is now).
// Up from the first line goes to the start, Down from the last to the end.
function verticalMove(lay, index, dir, goalX) {
  const L = lineOfIndex(lay, index), gx = goalX === null || goalX === undefined ? caretAt(lay, index).x : goalX;
  let j = L.i + dir;
  while (j >= 0 && j < lay.lines.length && lay.lines[j].top === L.top) j += dir;   // (the lines beside this one, on the same row, are not above or below it)
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
