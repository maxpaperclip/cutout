'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');

const plain = x => JSON.parse(JSON.stringify(x));

/*
 * Text that flows around shapes, on a monospace stand-in for a font: every character is 5 wide at size 10, a line is 10 tall.
 * The text box is 100 wide (20 characters) and sits at the page's top left, so the page and the box share coordinates.
 */
function fakeFont(log) {
  const forEachGlyph = (text, x, y, size, opts, cb) => { for (let i = 0; i < text.length; i++) { cb({ index: i }, x, y, size); x += size * 0.5; } return x; };
  return {
    unitsPerEm: 1000, ascender: 800, descender: -200,
    getAdvanceWidth: (text, size, opts) => forEachGlyph(text, 0, 0, size, opts, () => {}),
    forEachGlyph,
    getPath: (text, x, y, size) => { if (log) log.push({ text, x: Math.round(x * 1000) / 1000, y }); return { toPathData: () => 'M' + x + ' ' + y + 'L' + (x + 4) + ' ' + y + 'L' + (x + 4) + ' ' + (y - 5) + 'Z' }; },
  };
}
const WORDS = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp';
function setup(props, shapes) {
  const m = loadAppModules(), log = [], font = fakeFont(log);
  m._sandbox.fontOf = () => font;
  m._sandbox.fonts = { fake: {} };
  const o = m.newShape('text', Object.assign({ x: 0, y: 0, size: 10, lh: 1, font: 'fake', bw: 100, text: WORDS }, props));
  m.doc.objects.push(o);
  const made = (shapes || []).map(s => { const sh = m.newShape(s.kind || 'rect', Object.assign({ wrap: true, wgap: 0 }, s)); m.doc.objects.push(sh); return sh; });
  m.refresh(o);
  return { m, o, log, made, lay: () => m.textLayout(o) };
}
const rectAt = (x, y, w, h, more) => Object.assign({ kind: 'rect', x, y, w, h }, more);
const joined = lay => lay.lines.map(l => l.text).join('');

test('a shape in the middle splits the rows beside it into two stretches', async (t) => {
  await t.test('the text goes left of it, then right of it, then on to the next row', () => {
    const { lay } = setup({}, [rectAt(40, 10, 20, 20)]);
    const L = lay();
    const row = n => L.lines.filter(l => l.row === n);
    assert.equal(row(0).length, 1);
    assert.equal(row(1).length, 2); assert.equal(row(2).length, 2);
    assert.deepEqual(plain(row(1).map(l => [l.sx, l.sw])), [[0, 40], [60, 40]]);
    assert.equal(row(3).length, 1);
    assert.equal(joined(L), WORDS);
    // nothing is ever put inside the shape's span
    L.lines.forEach(l => { if (l.row === 1 || l.row === 2) assert.ok(l.x + l.tw <= 40 + 1e-9 || l.x >= 60 - 1e-9, 'line at ' + l.x); });
  });
  await t.test('the lines of a row share a baseline, and a row is as tall as one line', () => {
    const L = setup({}, [rectAt(40, 10, 20, 20)]).lay();
    const r1 = L.lines.filter(l => l.row === 1);
    assert.equal(r1[0].base, r1[1].base);
    assert.equal(r1[0].top, 10);
    assert.equal(L.h, 10 * (Math.max(...L.lines.map(l => l.row)) + 1));
  });
  await t.test('indexes run on from the left piece to the right piece', () => {
    const L = setup({}, [rectAt(40, 10, 20, 20)]).lay();
    L.lines.forEach((l, i) => { if (i) assert.equal(l.start, L.lines[i - 1].end); });
    assert.equal(L.lines[0].start, 0);
  });
  await t.test('it is not flat any more (a line is no longer at i * lineH)', () => {
    assert.equal(setup({}, [rectAt(40, 10, 20, 20)]).lay().flat, false);
    assert.equal(setup({}).lay().flat, true);
  });
});

test('a shape at one side moves the text over; one across the box moves it down', async (t) => {
  await t.test('on the left, the text starts after it', () => {
    const L = setup({}, [rectAt(-20, 0, 50, 30)]).lay();
    L.lines.filter(l => l.row < 3).forEach(l => { assert.equal(l.sx, 30); assert.equal(l.x, 30); });
    assert.equal(L.lines.find(l => l.row === 3).sx, 0);
  });
  await t.test('on the right, the text ends before it', () => {
    const L = setup({}, [rectAt(70, 0, 50, 30)]).lay();
    L.lines.filter(l => l.row < 3).forEach(l => { assert.equal(l.sx, 0); assert.equal(l.sw, 70); });
  });
  await t.test('across the whole box, the rows beside it are left empty', () => {
    const L = setup({}, [rectAt(-10, 10, 120, 20)]).lay();
    assert.deepEqual(plain(L.lines.map(l => l.row)).slice(0, 3), [0, 3, 4]);
    assert.equal(L.lines[1].top, 30);
    assert.equal(joined(L), WORDS);
  });
  await t.test('a shape that is clear of the box changes nothing', () => {
    const base = setup({}).lay(), far = setup({}, [rectAt(300, 0, 20, 20), rectAt(0, -50, 100, 20)]).lay();
    assert.deepEqual(plain(far.lines.map(l => l.text)), plain(base.lines.map(l => l.text)));
    assert.equal(far.flat, true);
  });
});

test('the gap, the stroke, and which shapes count', async (t) => {
  await t.test('the gap widens what is kept clear, around as well as beside', () => {
    const { m, made, o } = setup({}, [rectAt(40, 20, 20, 20, { wgap: 10 })]);
    const obs = m.wrapObstacles(o);
    assert.deepEqual(plain(m.wrapBlocked(obs, 10, 20)), [[30, 70]]);   // one row above the shape: reached by the gap
    assert.deepEqual(plain(m.wrapBlocked(obs, 0, 10)), []);
    assert.deepEqual(plain(m.wrapBlocked(obs, 20, 30)), [[30, 70]]);
    made[0].wgap = 0;
    assert.deepEqual(plain(m.wrapBlocked(m.wrapObstacles(o), 10, 20)), []);
  });
  await t.test('an outline adds half its width; a shape with no gap set uses the default', () => {
    const { m, o } = setup({}, [rectAt(40, 20, 20, 20, { stroke: '#000', sw: 4 }), rectAt(0, 200, 10, 10, { wgap: undefined })]);
    const obs = m.wrapObstacles(o);
    assert.equal(obs[0].pad, 2);
    assert.equal(obs[1] && obs[1].pad, m.WRAP_GAP);
  });
  await t.test('only shapes that are switched on, shown, and not text are wrapped around', () => {
    const { m, o, made } = setup({}, [rectAt(40, 10, 20, 20, { wrap: false }), rectAt(40, 10, 20, 20, { hidden: true }), rectAt(40, 10, 20, 20)]);
    assert.equal(m.wrapObstacles(o).length, 1);
    const other = m.newShape('text', { x: 40, y: 10, size: 10, font: 'fake', wrap: true, bw: 20, text: 'zz' });
    m.doc.objects.push(other);
    assert.equal(m.wrapObstacles(o).length, 1);
    assert.equal(m.canWrapAround(other), false);
    assert.equal(m.canWrapAround(made[0]), true);
  });
  await t.test('point text has no box to flow in: nothing changes', () => {
    const { lay } = setup({ bw: undefined, text: 'aaaa bbbb' }, [rectAt(0, 0, 100, 100)]);
    assert.equal(lay().lines.length, 1);
    assert.equal(lay().lines[0].x, 0);
  });
});

test('the real outline is followed, not the box', async (t) => {
  await t.test('a circle blocks more at its middle than near its top', () => {
    const { m, o } = setup({}, [{ kind: 'ellipse', x: 20, y: 0, w: 60, h: 60 }]);
    const obs = m.wrapObstacles(o), top = m.wrapBlocked(obs, 0, 4)[0], mid = m.wrapBlocked(obs, 28, 32)[0];
    assert.ok(top[1] - top[0] < 30, 'near the top: ' + (top[1] - top[0]));
    assert.ok(mid[1] - mid[0] > 59, 'at the middle: ' + (mid[1] - mid[0]));
    assert.ok(Math.abs((mid[0] + mid[1]) / 2 - 50) < 1e-6);
  });
  await t.test('text beside a circle gets longer lines near the top and bottom of it', () => {
    const L = setup({}, [{ kind: 'ellipse', x: 20, y: 0, w: 60, h: 60 }]).lay();
    const width = n => L.lines.filter(l => l.row === n).reduce((a, l) => a + l.sw, 0);
    assert.ok(width(0) > width(2) && width(5) > width(3), [0, 1, 2, 3, 4, 5].map(width).join());
  });
  await t.test('a star (a drawn path) is followed too', () => {
    const { m, o } = setup({}, [{ kind: 'polygon', x: 20, y: 0, w: 60, h: 60, star: true, sides: 5, inner: 0.4 }]);
    const obs = m.wrapObstacles(o);
    assert.ok(obs.length === 1 && obs[0].polys[0].length >= 10);
    const spans = [0, 1, 2, 3, 4, 5].map(i => m.wrapBlocked(obs, i * 10, i * 10 + 10)).map(s => s.length ? s[0][1] - s[0][0] : 0);
    assert.ok(Math.max(...spans) > Math.min(...spans.filter(v => v > 0)), spans.join());
  });
  await t.test('a straight line wraps text away from it', () => {
    const { m, o } = setup({}, [{ kind: 'path', x: 50, y: 0, w: 0.01, h: 100, nat: { d: 'M0 0L0.01 100', w: 0.01, h: 100 }, stroke: '#000', sw: 4 }]);
    assert.equal(m.wrapBlocked(m.wrapObstacles(o), 10, 20).length, 1);
  });
});

test('turned and mirrored things', async (t) => {
  await t.test('a turned shape is blocked where it really is', () => {
    // a 60 x 20 bar turned 90 degrees about its middle (50, 50) is 20 wide and 60 tall: it spans x 40..60, y 20..80
    const { m, o } = setup({}, [rectAt(20, 40, 60, 20, { rot: 90 })]);
    const obs = m.wrapObstacles(o);
    assert.deepEqual(plain(m.wrapBlocked(obs, 30, 40).map(s => s.map(v => Math.round(v * 1e6) / 1e6))), [[40, 60]]);
    assert.deepEqual(plain(m.wrapBlocked(obs, 0, 10)), []);
  });
  await t.test('a turned text sees the shapes in its own coordinates', () => {
    const { m, o } = setup({ x: 200, y: 100, rot: 90 }, [rectAt(200 + 40, 100 + 10, 20, 20)]);
    // text turned a quarter turn about its middle: page offsets (dx, dy) from the box's centre land at box offsets (dy, -dx) turned back
    const ob = m.wrapObstacles(o);
    assert.equal(ob.length, 1);
    const b = ob[0].b;
    assert.ok(b.x1 - b.x0 > 19 && b.y1 - b.y0 > 19);
  });
  await t.test('a mirrored shape (an asymmetric one) is on the side it is drawn', () => {
    const tri = { kind: 'path', x: 20, y: 0, w: 60, h: 40, nat: { d: 'M0 0L60 0L0 40Z', w: 60, h: 40 }, wgap: 0 };
    const a = setup({}, [tri]), b = setup({}, [Object.assign({ fx: true }, tri)]);
    const near = (s) => s.m.wrapBlocked(s.m.wrapObstacles(s.o), 30, 40)[0];
    assert.ok(near(a)[1] < 40 + 1e-6 && near(a)[0] >= 20 - 1e-6);   // the point of the triangle is at the left, low
    assert.ok(near(b)[0] > 60 - 1e-6);
  });
});

test('narrow stretches', async (t) => {
  await t.test('a stretch too narrow for a letter or two is not used', () => {
    const L = setup({}, [rectAt(-10, 0, 100, 30, { wgap: 0 }), rectAt(0, 0, 100, 0.01)]).lay();   // leaves 10 wide at the right: under the minimum
    assert.ok(L.lines.every(l => l.row >= 3 || l.sw >= 10));
  });
  await t.test('a word that does not fit beside a shape is not cut up to fill the gap: it waits for room', () => {
    const text = 'aa ' + 'b'.repeat(14) + ' cc';   // the long word needs 70; the stretches beside the shape are 40 wide
    const L = setup({ text }, [rectAt(40, 0, 20, 40)]).lay();
    const withB = L.lines.filter(l => l.text.includes('b'));
    assert.equal(withB.length, 1, 'the word is on one line: ' + plain(L.lines.map(l => l.text)).join('|'));
    assert.ok(withB[0].text.startsWith('b'.repeat(14)));
  });
  await t.test('a word too long for the whole box is still cut, so the text always ends', () => {
    const L = setup({ text: 'c'.repeat(50) }, [rectAt(40, 0, 20, 20)]).lay();
    assert.equal(joined(L), 'c'.repeat(50));
  });
  await t.test('a shape that is taller than anything: the text still ends', () => {
    const L = setup({}, [rectAt(-5, -5, 110, 5000)]).lay();
    assert.equal(joined(L), WORDS);
  });
});

test('alignment and justification are within each stretch', async (t) => {
  await t.test('center and right use the stretch, not the box', () => {
    const base = { text: 'aa bb cc dd ee ff gg hh ii jj kk ll mm nn oo pp qq rr' };
    const c = setup(Object.assign({ align: 'center' }, base), [rectAt(60, 0, 40, 100)]).lay();
    const r = setup(Object.assign({ align: 'right' }, base), [rectAt(60, 0, 40, 100)]).lay();
    c.lines.filter(l => l.hard === false).forEach(l => assert.ok(Math.abs(l.x - (l.sw - l.tw) / 2) < 1e-9));
    r.lines.forEach(l => assert.ok(l.x + l.tw <= 60 + 1e-9));
  });
  await t.test('justified lines fill their own stretch', () => {
    const L = setup({ align: 'justify', text: 'aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo ppp qqq rrr sss' }, [rectAt(40, 10, 20, 20)]).lay();
    L.lines.filter(l => !l.hard && l.slots).forEach(l => assert.ok(Math.abs(l.tw - l.sw) < 1e-9, 'tw ' + l.tw + ' sw ' + l.sw));
    assert.ok(L.lines.some(l => l.slots && l.sw === 40), 'a justified line in a stretch beside the shape');
  });
});

test('drawing, caret and clicks on a row with two pieces', async (t) => {
  await t.test('each piece is drawn where it was laid out', () => {
    const { m, o, log } = setup({}, [rectAt(40, 10, 20, 20)]);
    log.length = 0; m.buildText(o);
    const L = m.textLayout(o), xs = new Set(log.map(l => l.x));
    L.lines.forEach(l => assert.ok(xs.has(l.x), 'drawn at ' + l.x));
    const second = L.lines.filter(l => l.row === 1)[1];
    assert.ok(log.some(l => l.x === second.x && l.y === second.base));
  });
  await t.test('a click picks the piece it is over', () => {
    const { m, o } = setup({}, [rectAt(40, 10, 20, 20)]);
    const L = m.textLayout(o), r1 = L.lines.filter(l => l.row === 1);
    assert.equal(m.indexAtPoint(L, 10, 15), m.indexAtPoint(L, 10, 15));
    assert.ok(m.indexAtPoint(L, 5, 15) < r1[1].start);
    assert.ok(m.indexAtPoint(L, 70, 15) >= r1[1].start);
    assert.ok(m.indexAtPoint(L, 55, 15) >= r1[1].start || m.indexAtPoint(L, 55, 15) <= r1[0].cend);   // (in the shape: the nearer piece)
  });
  await t.test('the caret is on the right piece for an index', () => {
    const { m, o } = setup({}, [rectAt(40, 10, 20, 20)]);
    const L = m.textLayout(o), r1 = L.lines.filter(l => l.row === 1);
    const c = m.caretAt(L, r1[1].start + 1);
    assert.equal(c.x, r1[1].x + 5);
  });
  await t.test('Down goes to the row below, not to the piece beside', () => {
    const { m, o } = setup({}, [rectAt(40, 10, 20, 20)]);
    const L = m.textLayout(o), r1 = L.lines.filter(l => l.row === 1);
    const from = r1[0].start + 1;
    const down = m.verticalMove(L, from, 1, null), up = m.verticalMove(L, from, -1, null);
    assert.equal(m.lineOfIndex(L, down.index).row, 2);
    assert.equal(m.lineOfIndex(L, up.index).row, 0);
    const right = m.verticalMove(L, r1[1].start + 1, 1, null);
    assert.equal(m.lineOfIndex(L, right.index).row, 2);
  });
  await t.test('a selection across the two pieces is two rectangles on the row', () => {
    const { m, o } = setup({}, [rectAt(40, 10, 20, 20)]);
    const L = m.textLayout(o), r1 = L.lines.filter(l => l.row === 1);
    const rects = plain(m.selectionRects(L, r1[0].start, r1[1].end)).filter(r => r.y === r1[0].base - r1[0].asc);
    assert.equal(rects.length, 2);
    assert.ok(rects[0].x + rects[0].w <= 40 + 1e-9 && rects[1].x >= 60 - 1e-9);
  });
});

test('layouts follow the shapes', async (t) => {
  await t.test('moving the shape changes the text, and so does turning wrapping off', () => {
    const { m, o, made } = setup({}, [rectAt(40, 10, 20, 20)]);
    const h0 = o.h;
    assert.ok(o.d.length > 0);
    assert.ok(m.wrapSig(m.wrapObstacles(o)) !== '');
    made[0].x = 400;
    assert.equal(m.wrapSyncAll(), true);
    assert.ok(o.h < h0 || o.h === h0);
    assert.equal(m.wrapSig(m.wrapObstacles(o)), '');
    assert.equal(m.wrapSyncAll(), false);   // nothing left to do
    made[0].x = 40; made[0].wrap = false;
    assert.equal(m.wrapSyncAll(), false);
  });
  await t.test('a shape across the box makes the text taller, and it settles back', () => {
    const { m, o, made } = setup({}, [rectAt(-10, 10, 120, 100)]);
    const tall = o.h;
    made[0].wrap = false;
    assert.equal(m.wrapSyncAll(), true);
    assert.ok(o.h < tall);
    made[0].wrap = true;
    m.wrapSyncAll();
    assert.equal(o.h, tall);
  });
  await t.test('different shapes give different cached layouts', () => {
    const a = setup({}, [rectAt(40, 10, 20, 20)]), b = setup({}, [rectAt(10, 10, 20, 20)]);
    assert.notEqual(a.m.layoutText(a.o).d, b.m.layoutText(b.o).d);
  });
  await t.test('moving the text across a shape changes it too', () => {
    const { m, o } = setup({}, [rectAt(40, 10, 20, 20)]);
    const d0 = o.d;
    o.y = 5; m.wrapSyncAll();
    assert.notEqual(o.d, d0);
  });
});

test('saving, opening and the rest of the editor', async (t) => {
  await t.test('the switch and the gap are saved and opened again', () => {
    const { m, made } = setup({}, [rectAt(40, 10, 20, 20, { wgap: 12 })]);
    const back = m.sanitizeDoc(JSON.parse(m.docJSON(m.doc)));
    const r = back.objects.find(o => o.kind === 'rect');
    assert.equal(r.wrap, true); assert.equal(r.wgap, 12);
    made[0].wrap = false; delete made[0].wgap;
    const off = m.sanitizeDoc(JSON.parse(m.docJSON(m.doc))).objects.find(o => o.kind === 'rect');
    assert.equal(off.wrap, undefined); assert.equal(off.wgap, undefined);
  });
  await t.test('nonsense is not kept: a wrapping text, a bad gap, a non-boolean switch', () => {
    const { m } = setup({});
    const d = m.sanitizeDoc({ w: 800, h: 600, objects: [
      { kind: 'text', text: 'abc', size: 10, font: 'fake', x: 0, y: 0, wrap: true },
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10, wrap: 'yes', wgap: 5 },
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10, wrap: true, wgap: -4 },
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10, wrap: true, wgap: 99999 }] });
    assert.equal(d.objects[0].wrap, undefined);
    assert.equal(d.objects[1].wrap, undefined);
    assert.equal(d.objects[2].wrap, true); assert.equal(d.objects[2].wgap, undefined);
    assert.equal(d.objects[3].wgap, 200);
  });
  await t.test('a text that wraps around a shape can still be broken apart', () => {
    const { m, o } = setup({ text: 'aaaa bbbb cccc dddd eeee' }, [rectAt(40, 10, 20, 20)]);
    const r = m.breakApartText(o);
    assert.equal(r.shapes.length, 20);
  });
});
