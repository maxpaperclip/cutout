'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');

const plain = x => JSON.parse(JSON.stringify(x));
// Monospace stand-in: a character is half the size wide, ascender 0.8 and descender 0.2 of the size.
// At size 100 with line height 1.2 a line is 120 tall; at size 200 it is 240.
function fakeFont(log) {
  const walk = (text, x, y, size, opts, cb) => {
    const step = size * 0.5 + ((opts && opts.letterSpacing) || 0) * size;
    for (let i = 0; i < text.length; i++) { cb({ index: i }, x, y, size); x += step; }
    return x;
  };
  return {
    unitsPerEm: 1000, ascender: 800, descender: -200,
    getAdvanceWidth: (text, size, opts) => walk(text, 0, 0, size, opts, () => {}),
    forEachGlyph: walk,
    getPath: (text, x, y, size) => { if (log) log.push({ text, x, y, size }); return { toPathData: () => 'P' + text + ';' }; },
  };
}
function setup(props, log) {
  const m = loadAppModules();
  const font = fakeFont(log);
  m._sandbox.fontOf = () => font;
  const o = m.newShape('text', Object.assign({ x: 0, y: 0, size: 100, font: 'fake' }, props));
  return { m, o, lay: () => m.textLayout(o) };
}

test('runs layout', async (t) => {
  await t.test('letters at twice the size are twice as wide, and the line grows to hold them', () => {
    const { o, lay } = setup({ text: 'abcd', runs: [{ n: 2 }, { n: 2, s: 2 }] });
    const L = lay().lines[0];
    assert.deepEqual(plain(L.m.xs), [0, 50, 100, 200, 300]);
    assert.deepEqual(plain(L.segs.map(g => [g.a, g.b, g.size, g.x])), [[0, 2, 100, 0], [2, 4, 200, 100]]);
    assert.equal(L.h, 240);
    assert.equal(L.base, 180);   // (240 - 200) / 2 + 160
    assert.equal(o.w, 300);
    assert.equal(o.h, 240);
  });

  await t.test('segments are drawn where the layout puts them, at their own size', () => {
    const log = [];
    setup({ text: 'abcd', runs: [{ n: 2 }, { n: 2, s: 2 }] }, log);
    assert.deepEqual(log, [{ text: 'ab', x: 0, y: 180, size: 100 }, { text: 'cd', x: 100, y: 180, size: 200 }]);
  });

  await t.test('lines are as tall as their biggest letters and stack up from there', () => {
    const { o, lay } = setup({ text: 'ab\ncd\nef', runs: [{ n: 3 }, { n: 2, s: 2 }, { n: 3 }] });
    assert.deepEqual(plain(lay().lines.map(L => [L.top, L.h])), [[0, 120], [120, 240], [360, 120]]);
    assert.equal(o.h, 480);
    assert.equal(lay().flat, false);
  });

  await t.test('a click finds the line by its real height', () => {
    const { m, lay } = setup({ text: 'ab\ncd\nef', runs: [{ n: 3 }, { n: 2, s: 2 }, { n: 3 }] });
    assert.equal(m.indexAtPoint(lay(), 0, 119), 0);
    assert.equal(m.indexAtPoint(lay(), 0, 121), 3);
    assert.equal(m.indexAtPoint(lay(), 0, 359), 3);
    assert.equal(m.indexAtPoint(lay(), 0, 361), 6);
    assert.equal(m.indexAtPoint(lay(), 0, -50), 0);
    assert.equal(m.indexAtPoint(lay(), 0, 9999), 6);
  });

  await t.test('a click in a mixed line lands between the right letters', () => {
    const { m, lay } = setup({ text: 'abcd', runs: [{ n: 2 }, { n: 2, s: 2 }] });
    // gaps at 0, 50, 100, 200, 300
    assert.equal(m.indexAtPoint(lay(), 140, 50), 2);
    assert.equal(m.indexAtPoint(lay(), 160, 50), 3);
    assert.equal(m.indexAtPoint(lay(), 260, 50), 4);
  });

  await t.test('the caret and the highlight are as tall as their line', () => {
    const { m, lay } = setup({ text: 'abcd', runs: [{ n: 2 }, { n: 2, s: 2 }] });
    const c = m.caretAt(lay(), 1);
    assert.equal(c.x, 50); assert.equal(c.y0, 20); assert.equal(c.y1, 220);
    assert.deepEqual(plain(m.selectionRects(lay(), 1, 3)), [{ x: 50, y: 20, w: 150, h: 200 }]);
  });

  await t.test('an empty line takes the size of its line break', () => {
    const { lay } = setup({ text: 'a\n\nb', runs: [{ n: 2 }, { n: 1, s: 2 }, { n: 1 }] });
    assert.deepEqual(plain(lay().lines.map(L => L.h)), [120, 240, 120]);
  });

  await t.test('moving up and down uses the middle of the line it moves to', () => {
    const { m, lay } = setup({ text: 'ab\ncd\nef', runs: [{ n: 3 }, { n: 2, s: 2 }, { n: 3 }] });
    const v = m.verticalMove(lay(), 7, -1, null);   // from the 3rd line's middle, up
    assert.equal(v.index >= 3 && v.index <= 5, true);
  });

  await t.test('coloring alone moves nothing', () => {
    const a = setup({ text: 'abcd\nef' }), b = setup({ text: 'abcd\nef', runs: [{ n: 1 }, { n: 3, c: '#f00' }, { n: 2 }] });
    const strip = l => plain(l.lines.map(L => [L.m.xs, L.top, L.base, L.h]));
    assert.deepEqual(strip(b.lay()), strip(a.lay()));
    assert.equal(b.o.w, a.o.w); assert.equal(b.o.h, a.o.h);
  });

  await t.test('without runs the layout is flat, as it always was', () => {
    const { lay } = setup({ text: 'ab\ncd' });
    assert.equal(lay().flat, true);
    assert.deepEqual(plain(lay().lines.map(L => L.top)), [0, 120]);
  });
});

test('runs drawing', async (t) => {
  await t.test('letters in another color are drawn as their own piece, at the position the layout gives', () => {
    const log = [];
    const { o } = setup({ text: 'abcd', runs: [{ n: 1 }, { n: 2, c: '#f00' }, { n: 1 }] }, log);
    assert.deepEqual(log.map(c => [c.text, c.x]), [['a', 0], ['bc', 50], ['d', 150]]);
    assert.equal(o.d, 'Pa;Pbc;Pd;');
    assert.deepEqual(plain(o.parts), [{ d: 'Pa;Pd;' }, { d: 'Pbc;', c: '#f00' }]);
  });

  await t.test('no colored letters, no parts; and taking the runs away takes the parts away', () => {
    const { m, o } = setup({ text: 'abcd', runs: [{ n: 2 }, { n: 2, s: 2 }] });
    assert.equal(o.parts, undefined);
    o.runs = [{ n: 1 }, { n: 1, c: '#0f0' }, { n: 2 }]; m.refresh(o);
    assert.equal(o.parts.length, 2);
    delete o.runs; m.refresh(o);
    assert.equal(o.parts, undefined);
  });

  await t.test('another size or another run list is not served from the layout cache', () => {
    const { m, o } = setup({ text: 'abcd' });
    const w = o.w;
    o.runs = [{ n: 2 }, { n: 2, s: 2 }]; m.refresh(o);
    assert.notEqual(o.w, w);
    o.runs = [{ n: 2 }, { n: 2, s: 3 }]; m.refresh(o);
    assert.equal(o.w, 400);
  });

  await t.test('the saved drawing keeps the runs but not the pieces', () => {
    const { m, o } = setup({ text: 'abcd', runs: [{ n: 1 }, { n: 1, c: '#0f0' }, { n: 2 }] });
    const j = JSON.parse(m.docJSON({ objects: [o] })).objects[0];
    assert.equal(j.d, undefined); assert.equal(j.parts, undefined);
    assert.deepEqual(j.runs, plain(o.runs));
  });

  await t.test('the canvas and export draw one outline per color', () => {
    const { m, o } = setup({ text: 'abcd', fill: '#111111', runs: [{ n: 1 }, { n: 2, c: '#f00' }, { n: 1 }] });
    const v = m.objView(o, { grad: 'g', clip: 'c', mask: 'm' });
    const fills = v.node.kids.map(k => [k.a.fill, k.a.d]);
    assert.deepEqual(plain(fills), [['#111111', 'Pa;Pd;'], ['#f00', 'Pbc;']]);
  });
});
