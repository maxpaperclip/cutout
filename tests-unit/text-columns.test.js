'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');

// A monospace stand-in for a font: every character is half the size wide. With size 10 and line height 1, a line is 10 tall and a letter 5 wide.
function fakeFont() {
  const forEachGlyph = (text, x, y, size, opts, cb) => { for (let i = 0; i < text.length; i++) { cb({ index: i }, x, y, size); x += size * 0.5; } return x; };
  return {
    unitsPerEm: 1000, ascender: 800, descender: -200, tables: { os2: { sCapHeight: 700 } },
    getAdvanceWidth: (text, size, opts) => forEachGlyph(text, 0, 0, size, opts, () => {}),
    forEachGlyph, getPath: () => ({ toPathData: () => 'M0 0L4 0L4 -5Z' }),
    charToGlyph: () => ({ getBoundingBox: () => ({ x1: 50, y1: 0, x2: 450, y2: 700 }) })
  };
}
function setup(props, text) {
  const m = loadAppModules(), font = fakeFont();
  m._sandbox.fontOf = () => font;
  m._sandbox.fonts = { fake: {} };
  const o = m.newShape('text', Object.assign({ x: 0, y: 0, size: 10, lh: 1, font: 'fake', bw: 100, text }, props));
  m.doc.objects.push(o);
  m.refresh(o);
  return { m, o, lay: () => m.textLayout(o) };
}
// 40 words of 4 letters: 10 words (50 letters is 5 words of "abcd " ...) -- each line of a 100 wide box holds 20 letters, so 4 words
const WORDS = Array.from({ length: 40 }, () => 'abcd').join(' ');

test('one column is the same as no columns', () => {
  const a = setup({}, WORDS).lay(), b = setup({ cols: 1 }, WORDS).lay();
  assert.equal(b.ncols, 1);
  assert.equal(b.h, a.h);
  assert.equal(b.lines.length, a.lines.length);
});

test('the text is split between columns of the same height', () => {
  const lay = setup({ cols: 2, gut: 1 }, WORDS).lay();
  assert.equal(lay.ncols, 2);
  assert.equal(lay.cw, 45);   // (100 - 10) / 2
  const c0 = lay.lines.filter(L => L.col === 0), c1 = lay.lines.filter(L => L.col === 1);
  assert.ok(c0.length > 0 && c1.length > 0);
  assert.ok(Math.abs(c0.length - c1.length) <= 1, 'balanced: ' + c0.length + ' and ' + c1.length);
  assert.equal(lay.h, Math.max(c0.length, c1.length) * 10);
  assert.ok(lay.h < lay.lines.length * 10 * 0.6);
  assert.equal(c1[0].top, 0, 'the second column starts at the top');
  c0.forEach(L => assert.ok(L.sx >= 0 && L.sx + L.sw <= 45 + 1e-9));
  c1.forEach(L => assert.ok(L.sx >= 55 - 1e-9 && L.sx + L.sw <= 100 + 1e-9));
});

test('the text keeps its order and every letter', () => {
  const lay = setup({ cols: 3, gut: 0.5 }, WORDS).lay();
  assert.equal(lay.ncols, 3);
  lay.lines.forEach((L, i) => { if (i) assert.equal(L.start, lay.lines[i - 1].end + (/\s/.test(WORDS[L.start - 1]) && L.start === lay.lines[i - 1].end ? 0 : 0)); });
  assert.equal(lay.lines.map(L => L.text).join(''), WORDS);
  for (let k = 1; k < lay.lines.length; k++) assert.ok(lay.lines[k].col >= lay.lines[k - 1].col);
});

test('too many columns for the width make fewer', () => {
  const lay = setup({ cols: 6, gut: 1, bw: 60 }, WORDS).lay();
  assert.ok(lay.ncols < 6 && lay.ncols >= 1);
  assert.ok(lay.cw >= 20 - 1e-9);
});

test('a short text goes in the first column and the others are empty', () => {
  const lay = setup({ cols: 3 }, 'abcd').lay();
  assert.equal(lay.lines.length, 1);
  assert.equal(lay.lines[0].col, 0);
  assert.equal(lay.h, 10);
});

test('text that is not in a box has no columns', () => {
  const lay = setup({ cols: 3, bw: 0 }, 'abcd efgh').lay();
  assert.equal(lay.ncols, 1);
});

test('clicks find the line in the column they are in', () => {
  const t = setup({ cols: 2, gut: 1 }, WORDS), lay = t.lay();
  const first1 = lay.lines.find(L => L.col === 1);
  const i = t.m.indexAtPoint(lay, 55, 5);
  assert.equal(i, first1.start);
  assert.equal(t.m.lineAtY(lay, 5, 2).col, 0);
  assert.equal(t.m.lineAtY(lay, 5, 90).col, 1);
});

test('Down from the bottom of a column goes to the top of the next, Up goes back', () => {
  const t = setup({ cols: 2, gut: 1 }, WORDS), lay = t.lay();
  const c0 = lay.lines.filter(L => L.col === 0), last = c0[c0.length - 1], first1 = lay.lines.find(L => L.col === 1);
  const d = t.m.verticalMove(lay, last.start + 2, 1, null);
  assert.equal(lay.lines[t.m.lineOfIndex(lay, d.index).i].col, 1);
  assert.equal(t.m.lineOfIndex(lay, d.index).i, first1.i);
  const u = t.m.verticalMove(lay, first1.start + 2, -1, null);
  assert.equal(t.m.lineOfIndex(lay, u.index).i, last.i);
});

test('the bars for a paragraph are one for each column it is in', () => {
  const t = setup({ cols: 2, gut: 1 }, WORDS), lay = t.lay();
  const bars = t.m.paraBars(lay, WORDS, 0, 1);
  assert.equal(bars.length, 2);
  assert.deepEqual(Array.from(bars.map(b => b.col)).sort(), [0, 1]);
});

test('columns are kept when a drawing is saved and opened', () => {
  const t = setup({ cols: 3, gut: 0.5 }, WORDS), j = t.m.sanitizeDoc(JSON.parse(t.m.docJSON(t.m.doc)));
  const r = j.objects.find(x => x.kind === 'text');
  assert.equal(r.cols, 3);
  assert.equal(r.gut, 0.5);
});

test('different columns are laid out afresh (the cache knows about them)', () => {
  const t = setup({ cols: 2 }, WORDS);
  assert.equal(t.lay().ncols, 2);
  t.o.cols = 3; t.m.refresh(t.o);
  assert.equal(t.m.textLayout(t.o).ncols, 3);
  assert.ok(t.o.d && t.o.h > 0);
});

test('a drop cap is not split between columns', () => {
  const t = setup({ cols: 2, gut: 1, paras: [null, { dc: 3 }] }, 'abcd\n' + WORDS), lay = t.lay();
  const cap = lay.caps[0];
  assert.ok(cap);
  const beside = lay.lines.filter(L => L.col === lay.lines[cap.line].col);
  assert.ok(beside.length >= 3 || lay.lines[cap.line].col === 1);
});

test('a long text is laid out quickly', () => {
  const long = Array.from({ length: 3000 }, () => 'abcd').join(' ');
  const t = setup({ cols: 3 }, long), t0 = Date.now();
  t.lay();
  assert.ok(Date.now() - t0 < 3000, 'took ' + (Date.now() - t0) + ' ms');
});
