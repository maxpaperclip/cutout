/* =====================================================================
   Text paragraphs: settings that belong to one paragraph of a text (no DOM; unit tested)
   A paragraph is what lies between two line breaks (a text with no line break is one paragraph; an empty one counts).
   Most of a text is set for all of it (o.align, o.size...) and a different look for some letters is o.runs (04g-text-runs.js).
   Settings for one paragraph are o.paras: a list in reading order, one entry per paragraph, each { dc, dn, span } with only the
   keys that are set (a paragraph with none is {}; entries missing at the end mean the same). A text with nothing set has no
   o.paras at all, exactly as before.
     dc    drop cap: the first letters are one big letter this many lines tall (2 to 8; missing = no drop cap)
     dn    drop cap: how many letters of the paragraph it takes (1 to 3; missing = 1)
     span  'all': the paragraph runs across all the columns of the text (missing = it stays in its column)
   (textLayout, in 04f-text-layout.js, uses dc and dn. span is for text columns, which come later. This file is where the settings
   live, are kept in step with editing, and are saved and opened.)
   While a text is edited the paragraph controls change the paragraphs the selection touches (paraRange), and the paragraphs
   are shown by a bar beside the box (paraBars). A text that is only selected, not being edited, is changed in its first paragraph
   (teParaSet, in 09f-text-edit.js).
   ===================================================================== */
const PARA_SPEC = {
  dc: { min: 2, max: 8 },
  dn: { min: 1, max: 3 },
  span: { values: ['all'] }
};
const PARA_KEYS = Object.keys(PARA_SPEC);
const paraHas = p => !!p && PARA_KEYS.some(k => p[k] !== undefined);
const paraStyle = p => { const x = {}; PARA_KEYS.forEach(k => { if (p && p[k] !== undefined) x[k] = p[k]; }); return x; };

// A value for a key as it may be kept, or undefined (not a number, not a listed word: not kept)
function paraClean(key, v) {
  const sp = PARA_SPEC[key];
  if (!sp) return undefined;
  if (sp.values) return sp.values.indexOf(v) >= 0 ? v : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), sp.min, sp.max) : undefined;
}

/* ---------- where the paragraphs are ---------- */
// The index where each paragraph starts: the first at 0, the next one just after each line break
function paraStarts(text) {
  text = String(text);
  const out = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1);
  return out;
}
const paraCount = text => paraStarts(text).length;
// The paragraph an index is in (the line break that ends a paragraph is in it; the index just after it is in the next one)
function paraIndexAt(text, index) {
  const st = paraStarts(text);
  let k = 0;
  while (k + 1 < st.length && st[k + 1] <= index) k++;
  return k;
}
// The first and last paragraph a selection from a to b touches. A selection that ends just where the next paragraph begins
// does not reach into it.
function paraRange(text, a, b) {
  text = String(text);
  if (a > b) { const t = a; a = b; b = t; }
  a = clamp(a, 0, text.length); b = clamp(b, 0, text.length);
  const first = paraIndexAt(text, a), st = paraStarts(text);
  let last = paraIndexAt(text, b);
  if (b > a && last > first && st[last] === b) last--;
  return { first, last };
}

/* ---------- the list ---------- */
// Tidy a list for a text of count paragraphs: only known keys, no more entries than paragraphs, none left over at the end that
// set nothing. Gives undefined when nothing is set.
function normParas(paras, count) {
  const out = (Array.isArray(paras) ? paras : []).slice(0, count).map(paraStyle);
  while (out.length && !paraHas(out[out.length - 1])) out.pop();
  return out.length ? out : undefined;
}
// What is set for paragraph number k ({} when nothing is)
const paraSettingsAt = (paras, k) => paraStyle(Array.isArray(paras) ? paras[k] : null);
// The settings of the paragraph an index is in
const paraStyleAt = (o, index) => paraSettingsAt(o.paras, paraIndexAt(o.text, index));

// Set (or, given as null, clear) settings on the paragraphs a..b touches. attrs has the keys to change. Gives the new list.
function parasApply(paras, text, a, b, attrs) {
  const n = paraCount(text), r = paraRange(text, a, b), out = [];
  for (let k = 0; k < n; k++) out.push(paraSettingsAt(paras, k));
  for (let k = r.first; k <= r.last; k++) {
    PARA_KEYS.forEach(key => {
      if (!(key in attrs)) return;
      const v = paraClean(key, attrs[key]);
      if (attrs[key] === null || attrs[key] === undefined || v === undefined) delete out[k][key]; else out[k][key] = v;
    });
  }
  return normParas(out, n);
}
// Set them on a text object: the paragraphs a..b touches. Gives true when something changed.
function applyParaSettings(o, a, b, attrs) {
  const before = JSON.stringify(o.paras || null), paras = parasApply(o.paras, o.text, a, b, attrs);
  if (paras) o.paras = paras; else delete o.paras;
  return JSON.stringify(o.paras || null) !== before;
}

// The list after the text changed from oldText to newText, however it changed. What changed is found by comparing the two
// (as runsForEdit does for letters). The paragraphs that take part in it become one, which splits again at each line break typed:
// all of them keep the settings of the first one (so Enter makes a paragraph like the one it was pressed in, and joining two
// paragraphs by deleting the break between them keeps the first one's). Paragraphs before and after are not touched.
// caret (optional): where the caret is after the edit. Two breaks in a row, or a break next to a letter, look the same however
// they were typed, so the caret says where it really was (Enter at the end of a paragraph, not at the start of the next one).
function parasForEdit(paras, oldText, newText, caret) {
  oldText = String(oldText); newText = String(newText);
  if (!Array.isArray(paras)) return undefined;
  const oldN = paraCount(oldText);
  if (oldText === newText) return normParas(paras, oldN);
  const m = Math.min(oldText.length, newText.length);
  let p = 0, s = 0;
  while (p < m && oldText.charCodeAt(p) === newText.charCodeAt(p)) p++;
  while (s < m - p && oldText.charCodeAt(oldText.length - 1 - s) === newText.charCodeAt(newText.length - 1 - s)) s++;
  let a = p, b = oldText.length - s, ins = newText.length - s - p;
  // A pure insertion or a pure deletion is exactly where the caret says, when that gives the new text
  if (typeof caret === 'number' && (a === b) !== (ins === 0)) {
    const a2 = a === b ? caret - ins : caret, b2 = a2 + (b - a);
    if (a2 >= 0 && b2 <= oldText.length && oldText.slice(0, a2) + newText.slice(a2, a2 + ins) + oldText.slice(b2) === newText) { a = a2; b = b2; }
  }
  const at = paraIndexAt(oldText, a);
  const removed = (oldText.slice(a, b).match(/\n/g) || []).length, added = (newText.slice(a, a + ins).match(/\n/g) || []).length;
  const out = [];
  for (let k = 0; k < at; k++) out.push(paraSettingsAt(paras, k));
  for (let k = 0; k <= added; k++) out.push(paraSettingsAt(paras, at));
  for (let k = at + removed + 1; k < oldN; k++) out.push(paraSettingsAt(paras, k));
  return normParas(out, paraCount(newText));
}

// A list from a file or a paste, which might be anything: only what is understood is kept
function sanitizeParas(raw, text) {
  if (!Array.isArray(raw)) return undefined;
  const n = paraCount(text);
  const list = raw.slice(0, n).map(p => {
    const x = {};
    if (p && typeof p === 'object') PARA_KEYS.forEach(k => { const v = paraClean(k, p[k]); if (v !== undefined) x[k] = v; });
    return x;
  });
  return normParas(list, n);
}

/* ---------- showing which paragraphs ---------- */
// The stretch of height (box coordinates) each paragraph touched by a selection from a to b takes in a layout (textLayout):
// [{ p (its number), y0, y1, col }], from the top of its first line to the bottom of its last (one for each column it is in)
function paraBars(lay, text, a, b) {
  text = String(text);
  const r = paraRange(text, a, b), st = paraStarts(text), out = [];
  for (let p = r.first; p <= r.last; p++) {
    const s = st[p], e = p + 1 < st.length ? st[p + 1] - 1 : text.length;
    const cs = new Map();   // (a paragraph that runs over into another column has a stretch in each)
    lay.lines.forEach(L => {
      if (L.start < s || L.start > e) return;
      const c = cs.get(L.col || 0) || { y0: Infinity, y1: -Infinity };
      c.y0 = Math.min(c.y0, L.top); c.y1 = Math.max(c.y1, L.top + L.h); cs.set(L.col || 0, c);
    });
    cs.forEach((c, col) => { if (c.y1 > c.y0) out.push({ p, y0: c.y0, y1: c.y1, col }); });
  }
  return out;
}
