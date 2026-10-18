/* =====================================================================
   Text runs: a different color, size, font, spacing or line height for part of a text (no DOM; unit tested)
   A text has one color (o.fill), size (o.size), font (o.font), letter spacing (o.ls) and line height (o.lh) for all
   of it. To style only some letters, o.runs says where they differ: a list of { n, c, s, f, l, h } in reading order,
   each run covering n characters of o.text (the break between two lines counts as one character).
     c  color   a color, or 'none'; missing = the text's own fill
     s  size    a multiple of the text's size, so resizing the text keeps the proportions; missing = 1
     f  font    a face key; missing = the text's own font
     l  spacing letter spacing (as o.ls: a fraction of the letter's size); missing = the text's own
     h  height  line height (as o.lh: a multiple of the letter's size); missing = the text's own.
                A line is as tall as its tallest letter by this, so the largest line height on a line wins.
   A text with no differences has no o.runs at all, exactly as before. Runs are kept normalized: neighbours
   that look the same are one run, and the lengths add up to the length of the text.
   "Absolute" styles are what the controls show and take: { color, size (pixels), font, spacing, lineHeight }.
   ===================================================================== */
const RUN_KEYS = ['c', 's', 'f', 'l', 'h'];
const runHas = r => RUN_KEYS.some(k => r[k] !== undefined);
const runSame = (a, b) => RUN_KEYS.every(k => a[k] === b[k]);
const runStyle = r => { const x = {}; RUN_KEYS.forEach(k => { if (r && r[k] !== undefined) x[k] = r[k]; }); return x; };

// Tidy a list of runs for a text of len characters: no empty runs, neighbours that look the same joined,
// the lengths made to fit. Gives undefined when nothing in it differs from the text's own style.
function normRuns(runs, len) {
  const out = [];
  let total = 0;
  const add = (n, st) => {
    const last = out[out.length - 1];
    if (last && runSame(last, st)) last.n += n; else out.push(Object.assign({ n }, st));
  };
  (Array.isArray(runs) ? runs : []).forEach(r => {
    if (!r) return;
    const n = Math.min(Math.floor(r.n) || 0, len - total);
    if (n <= 0) return;
    const st = runStyle(r);
    if (st.s === 1) delete st.s;
    add(n, st);
    total += n;
  });
  if (total < len) add(len - total, {});
  return out.some(runHas) ? out : undefined;
}
// The style (c, s, f; whatever differs) of the character at an index
function runStyleAt(runs, i) {
  if (!runs) return {};
  let pos = 0;
  for (let k = 0; k < runs.length; k++) { if (i < pos + runs[k].n) return runStyle(runs[k]); pos += runs[k].n; }
  return {};
}
// The stretches of [a, b) that have one style each: [{ a, b, st }], covering all of it
function runSlices(runs, a, b) {
  const out = [];
  let pos = 0, cur = a;
  (runs || []).forEach(r => {
    const s = Math.max(a, pos), e = Math.min(b, pos + r.n);
    if (s < e) { out.push({ a: s, b: e, st: runStyle(r) }); cur = e; }
    pos += r.n;
  });
  if (cur < b) out.push({ a: cur, b, st: {} });   // (runs that stop short: the rest is plain)
  return out;
}
// Set styles on characters a..b. attrs has the keys to change; a key given as null (or undefined) goes back to the text's own.
function runsApply(runs, len, a, b, attrs) {
  a = clamp(a, 0, len); b = clamp(b, 0, len);
  if (a >= b) return normRuns(runs, len);
  const out = [];
  runSlices(runs, 0, len).forEach(p => {
    [[p.a, Math.min(p.b, a)], [Math.max(p.a, a), Math.min(p.b, b)], [Math.max(p.a, b), p.b]].forEach(([s, e], k) => {
      if (s >= e) return;
      const st = Object.assign({}, p.st);
      if (k === 1) RUN_KEYS.forEach(key => { if (key in attrs) { if (attrs[key] === null || attrs[key] === undefined) delete st[key]; else st[key] = attrs[key]; } });
      out.push(Object.assign({ n: e - s }, st));
    });
  });
  return normRuns(out, len);
}
// Replace characters a..b by insLen new ones in the given style (a { c, s, f } with nulls clearing)
function runsSplice(runs, len, a, b, insLen, style) {
  const before = [], after = [];
  runSlices(runs, 0, len).forEach(p => {
    if (p.a < a) before.push(Object.assign({ n: Math.min(p.b, a) - p.a }, p.st));
    if (p.b > b) after.push(Object.assign({ n: p.b - Math.max(p.a, b) }, p.st));
  });
  const mid = insLen > 0 ? [Object.assign({ n: insLen }, style || {})] : [];
  return normRuns(before.concat(mid, after), len - (b - a) + insLen);
}
// The runs after the text changed from oldText to newText, however it changed (typing, paste, cut, a replaced selection):
// what changed is found by comparing the two, and new letters take the style of the letter they replace, or else of the
// one before them (the one after, at the very start). pending: styles chosen at the caret, for the next letters typed.
function runsForEdit(runs, oldText, newText, pending) {
  if (oldText === newText) return normRuns(runs, newText.length);
  const m = Math.min(oldText.length, newText.length);
  let p = 0, s = 0;
  while (p < m && oldText.charCodeAt(p) === newText.charCodeAt(p)) p++;
  while (s < m - p && oldText.charCodeAt(oldText.length - 1 - s) === newText.charCodeAt(newText.length - 1 - s)) s++;
  const a = p, b = oldText.length - s, ins = newText.length - s - p;
  const base = Object.assign({}, runStyleAt(runs, b > a ? a : a > 0 ? a - 1 : 0));
  if (pending) RUN_KEYS.forEach(k => { if (k in pending) { if (pending[k] === null || pending[k] === undefined) delete base[k]; else base[k] = pending[k]; } });
  return runsSplice(runs, oldText.length, a, b, ins, base);
}
// Give a text object its new text, keeping the styles of the letters that stayed, and the settings of the paragraphs that did
// (use this, not o.text = ...). caret: where the caret is after the edit, when known (see parasForEdit in 04k-text-paragraphs.js)
function setTextValue(o, value, pending, caret) {
  const runs = runsForEdit(o.runs, String(o.text), value, pending);
  if (runs) o.runs = runs; else delete o.runs;
  if (o.paras) { const paras = parasForEdit(o.paras, String(o.text), value, caret); if (paras) o.paras = paras; else delete o.paras; }
  o.text = value;
}

/* ---------- absolute styles: what the controls show and take ---------- */
// What the letter at an index looks like: { color, size (pixels), font, spacing, lineHeight }
function textStyleAt(o, i) {
  const st = runStyleAt(o.runs, i);
  return {
    color: st.c !== undefined ? st.c : o.fill, size: o.size * (st.s !== undefined ? st.s : 1), font: st.f !== undefined ? st.f : o.font,
    spacing: st.l !== undefined ? st.l : o.ls || 0, lineHeight: st.h !== undefined ? st.h : o.lh
  };
}
const clampSpacing = v => rnd(clamp(v, -0.2, 2), 4), clampLineHeight = v => rnd(clamp(v, 0.6, 3), 4);
// Absolute styles ({ color, size, font, spacing, lineHeight }; any of them) as run attributes, for a text's own settings.
// Anything the same as the text's own becomes null: it is not stored.
function runAttrsFor(o, attrs) {
  const r = {};
  if ('color' in attrs) r.c = attrs.color === o.fill ? null : attrs.color;
  if ('size' in attrs) { const s = rnd(clamp(attrs.size, 4, 1200) / o.size, 5); r.s = s === 1 ? null : s; }
  if ('font' in attrs) r.f = attrs.font === o.font ? null : attrs.font;
  if ('spacing' in attrs) { const l = clampSpacing(attrs.spacing); r.l = l === (o.ls || 0) ? null : l; }
  if ('lineHeight' in attrs) { const h = clampLineHeight(attrs.lineHeight); r.h = h === o.lh ? null : h; }
  return r;
}
// Put absolute styles on characters a..b of a text object. The whole text is the text's own style (and clears what
// the letters had of it); a part of it becomes runs. Gives true when the text changed.
function applyTextStyle(o, a, b, attrs) {
  const len = String(o.text).length;
  a = clamp(a, 0, len); b = clamp(b, 0, len);
  if (a >= b) return false;
  const run = runAttrsFor(o, attrs);
  if (a === 0 && b === len) {
    if ('color' in attrs) { o.fill = attrs.color; delete o.grad; run.c = null; }
    if ('size' in attrs) { o.size = clamp(attrs.size, 4, 1200); run.s = null; }
    if ('font' in attrs) { o.font = attrs.font; run.f = null; }
    if ('spacing' in attrs) { o.ls = clampSpacing(attrs.spacing); run.l = null; }
    if ('lineHeight' in attrs) { o.lh = clampLineHeight(attrs.lineHeight); run.h = null; }
  }
  const runs = runsApply(o.runs, len, a, b, run);
  if (runs) o.runs = runs; else delete o.runs;
  return true;
}
// The same for the whole text object (also when there is no text yet): what it is, and no letter set apart in it
function applyWholeStyle(o, attrs) {
  if (applyTextStyle(o, 0, String(o.text).length, attrs)) return;
  if ('color' in attrs) { o.fill = attrs.color; delete o.grad; }
  if ('size' in attrs) o.size = clamp(attrs.size, 4, 1200);
  if ('font' in attrs) o.font = attrs.font;
  if ('spacing' in attrs) o.ls = clampSpacing(attrs.spacing);
  if ('lineHeight' in attrs) o.lh = clampLineHeight(attrs.lineHeight);
}
// True when any letter of the text is set in this face
const textUsesFont = (o, key) => o.kind === 'text' && (o.font === key || (Array.isArray(o.runs) && o.runs.some(r => r.f === key)));
// Every face a text uses
const textFonts = o => Array.from(new Set([o.font].concat((Array.isArray(o.runs) ? o.runs : []).map(r => r.f).filter(Boolean))));

// Runs from a file or a paste, which might be anything: only what is understood is kept. fontOK says whether a face exists.
function sanitizeRuns(raw, len, fontOK) {
  if (!Array.isArray(raw)) return undefined;
  const runs = raw.slice(0, 5000).map(r => {
    if (!r || typeof r !== 'object') return null;
    const n = Math.floor(Number(r.n));
    if (!(n > 0)) return null;
    const o = { n };
    if (r.c === 'none' || (typeof r.c === 'string' && /^#[0-9a-f]{3,8}$/i.test(r.c))) o.c = r.c;
    if (typeof r.s === 'number' && Number.isFinite(r.s)) o.s = rnd(clamp(r.s, 0.02, 300), 5);
    if (typeof r.f === 'string' && fontOK(r.f)) o.f = r.f;
    if (typeof r.l === 'number' && Number.isFinite(r.l)) o.l = clampSpacing(r.l);
    if (typeof r.h === 'number' && Number.isFinite(r.h)) o.h = clampLineHeight(r.h);
    return o;
  }).filter(Boolean);
  return normRuns(runs, len);
}
