'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');

const plain = x => JSON.parse(JSON.stringify(x));
const near = (a, b, msg, tol) => assert.ok(Math.abs(a - b) < (tol || 1e-6), (msg || '') + ' ' + a + ' is not ' + b);

/*
 * A monospace stand-in for a font: every character is half the size wide, capitals are 0.7 of the size tall (os2.sCapHeight), and
 * every letter's ink starts 0.05 of the size in. With size 10 and line height 1, a line is 10 tall and a letter 5 wide.
 * `log` records what getPath was asked to draw.
 */
function fakeFont({ log, tables, noGlyph } = {}) {
  const forEachGlyph = (text, x, y, size, opts, cb) => { for (let i = 0; i < text.length; i++) { cb({ index: i }, x, y, size); x += size * 0.5 + ((opts && opts.letterSpacing) || 0) * size; } return x; };
  const f = {
    unitsPerEm: 1000, ascender: 800, descender: -200,
    tables: tables || { os2: { sCapHeight: 700 } },
    getAdvanceWidth: (text, size, opts) => forEachGlyph(text, 0, 0, size, opts, () => {}),
    forEachGlyph,
    getPath: (text, x, y, size) => { if (log) log.push({ text, x, y, size }); return { toPathData: () => 'M' + x + ' ' + y + 'L' + (x + 4) + ' ' + y + 'L' + (x + 4) + ' ' + (y - 5) + 'Z' }; },
  };
  if (!noGlyph) f.charToGlyph = () => ({ getBoundingBox: () => ({ x1: 50, y1: 0, x2: 450, y2: 700 }) });
  return f;
}
function setup(props, fontOpts) {
  const m = loadAppModules(), log = [], font = fakeFont(Object.assign({ log }, fontOpts));
  m._sandbox.fontOf = () => font;
  m._sandbox.fonts = { fake: {} };
  const o = m.newShape('text', Object.assign({ x: 0, y: 0, size: 10, lh: 1, font: 'fake', bw: 100 }, props));
  m.doc.objects.push(o);
  m.refresh(o);
  return { m, o, log, lay: () => m.textLayout(o) };
}
const STORY = 'Once upon a time there was a small story told by a quiet voice to anyone who stopped to listen for a while.';
// With size 10, line height 1 and 3 lines: the cap is (2 * 10 + 0.7 * 10) / 0.7 tall in size, its letter is half that wide, its ink starts
// 0.05 of its size in, and the lines beside it are held in by that width less the start of the ink, plus 8% of its size
const SIZE = Math.round(27 / 0.7 * 1000) / 1000, WIDTH = SIZE * 0.5, LSB = SIZE * 0.05, INSET = WIDTH - LSB + SIZE * 0.08;

test('the size of a drop cap comes from how many lines it fills', async (t) => {
  await t.test('its capital is as tall as line 3 is far down, and starts level with the tops of the capitals on line 1', () => {
    const L = setup({ text: STORY, paras: [{ dc: 3 }] }).lay();
    assert.equal(L.caps.length, 1);
    const c = L.caps[0];
    near(c.size, SIZE, 'size');
    near(c.base, L.lines[0].base + 20, 'baseline is the baseline of line 3');
    near(c.top, L.lines[0].base - 7, 'top is where a capital of the body text tops out', 1e-3);   // (the size is kept to 3 places)
    near(c.top, c.base - 0.7 * c.size, 'and it is as tall as a capital of that size');
  });
  await t.test('more lines make a bigger cap, with the same rule', () => {
    const c4 = setup({ text: STORY, paras: [{ dc: 4 }] }).lay().caps[0];
    near(c4.size, Math.round(37 / 0.7 * 1000) / 1000, 'size');
    assert.ok(c4.size > SIZE);
  });
  await t.test('a different line height is followed (the baselines are that far apart)', () => {
    const L = setup({ text: STORY, lh: 1.5, paras: [{ dc: 2 }] }).lay();
    near(L.caps[0].base, L.lines[0].base + 15, 'line 2 is 15 below line 1');
  });
  await t.test('a face with no cap height of its own is measured on an H, and failing that is taken as 0.7', () => {
    const a = setup({ text: STORY, paras: [{ dc: 3 }] }, { tables: {} }).lay().caps[0];
    near(a.size, SIZE, 'measured');
    const b = setup({ text: STORY, paras: [{ dc: 3 }] }, { tables: {}, noGlyph: true }).lay().caps[0];
    near(b.size, SIZE, 'assumed');
    const c = setup({ text: STORY, paras: [{ dc: 3 }] }, { tables: { os2: { sCapHeight: 500 } } }).lay().caps[0];
    near(c.size, 25 / 0.5, 'a face with shorter capitals needs a bigger cap to match (its body capitals are shorter too)');
  });
});

test('the lines beside the cap', async (t) => {
  await t.test('the first 3 rows start after the cap, the rest at the margin', () => {
    const L = setup({ text: STORY, paras: [{ dc: 3 }] }).lay();
    L.lines.forEach((l, i) => near(l.sx, i < 3 ? INSET : 0, 'line ' + i));
    near(L.caps[0].x0, 0, 'the ink of the cap is at the margin');
    near(L.caps[0].x, -LSB, 'and it is drawn that much to the left of it');
  });
  await t.test('the letter is not in any line: the first line starts after it, and nothing is lost', () => {
    const L = setup({ text: STORY, paras: [{ dc: 3 }] }).lay();
    assert.equal(L.caps[0].text, 'O'); assert.equal(L.caps[0].i0, 0); assert.equal(L.caps[0].i1, 1);
    assert.equal(L.lines[0].start, 1);
    assert.equal('O' + L.lines.map(l => l.text).join(''), STORY);
    L.lines.forEach((l, i) => { if (i) assert.equal(l.start, L.lines[i - 1].end); });
  });
  await t.test('the lines are cut to the room that is left', () => {
    const L = setup({ text: STORY, paras: [{ dc: 3 }] }).lay();
    L.lines.slice(0, 3).forEach(l => assert.ok(l.x + l.tw <= 100 + 1e-9));
    assert.ok(L.lines[0].tw <= 100 - INSET + 1e-9);
  });
  await t.test('the paragraph has no first-line indent: the cap is its indent', () => {
    const withCap = setup({ text: STORY, indent: 2, paras: [{ dc: 3 }] }).lay();
    near(withCap.lines[0].sx, INSET, 'cap paragraph');
    const plainOne = setup({ text: STORY, indent: 2 }).lay();
    near(plainOne.lines[0].sx, 20, 'ordinary paragraph');
  });
  await t.test('two letters make a wider cap that takes both', () => {
    const L = setup({ text: STORY, paras: [{ dc: 3, dn: 2 }] }).lay();
    assert.equal(L.caps[0].text, 'On'); assert.equal(L.caps[0].i1, 2);
    near(L.lines[0].sx, SIZE * 1.0 - LSB + SIZE * 0.08, 'held in by both');
    assert.equal(L.lines[0].start, 2);
  });
  await t.test('an accent stays with its letter', () => {
    const L = setup({ text: 'École du soir est ouverte a tous les jours', paras: [{ dc: 2 }] }).lay();
    assert.equal(L.caps[0].text, 'É');
    assert.equal(L.caps[0].i1, 2);
  });
  await t.test('justified lines fill what is left of their row', () => {
    const L = setup({ text: STORY, align: 'justify', paras: [{ dc: 3 }] }).lay();
    assert.ok(Math.abs(L.lines[0].x + L.lines[0].tw - 100) < 1e-6);
    assert.ok(L.lines[0].x >= INSET - 1e-6);
  });
});

test('paragraphs of their own', async (t) => {
  await t.test('only the paragraph that has one gets a cap, and the next paragraph starts below it', () => {
    const L = setup({ text: 'Ab\ncd ef gh ij', paras: [{ dc: 3 }] }).lay();
    assert.equal(L.caps.length, 1);
    assert.equal(L.lines[0].text, 'b'); assert.equal(L.lines[0].row, 0);
    assert.equal(L.lines[1].text, 'cd ef gh ij');
    assert.equal(L.lines[1].row, 3); assert.equal(L.lines[1].top, 30);   // (a paragraph shorter than its cap leaves room for all of it)
    near(L.lines[1].sx, 0, 'and is not held in');
  });
  await t.test('a paragraph that is only the cap: it still has the room', () => {
    const L = setup({ text: 'A\nbc', paras: [{ dc: 3 }] }).lay();
    assert.equal(L.caps.length, 1);
    assert.equal(L.lines[0].text, ''); assert.equal(L.lines[0].start, 1);
    assert.equal(L.lines[1].top, 30);
  });
  await t.test('a cap on the second paragraph', () => {
    const L = setup({ text: 'aa bb\n' + STORY, paras: [{}, { dc: 3, dn: 1 }] }).lay();
    assert.equal(L.caps.length, 1);
    assert.equal(L.caps[0].p, 1); assert.equal(L.caps[0].i0, 6); assert.equal(L.caps[0].text, 'O');
    near(L.caps[0].base, L.lines[1].base + 20, 'baseline');
    near(L.lines[1].sx, INSET, 'held in'); near(L.lines[0].sx, 0, 'the first is not');
  });
  await t.test('caps in two paragraphs', () => {
    const L = setup({ text: STORY + '\n' + STORY, paras: [{ dc: 2 }, { dc: 3 }] }).lay();
    assert.equal(L.caps.length, 2);
    assert.ok(L.caps[1].size > L.caps[0].size);
  });
  await t.test('an empty paragraph has none', () => {
    const L = setup({ text: 'ab\n\ncd', paras: [{}, { dc: 3 }] }).lay();
    assert.equal(L.caps.length, 0);
  });
  await t.test('a text with no box (it is as wide as its words) has none', () => {
    const { m, o } = setup({ text: STORY, paras: [{ dc: 3 }] });
    delete o.bw; m.refresh(o);
    assert.equal(m.textLayout(o).caps.length, 0);
  });
});

test('caret, selection and clicks with a drop cap', async (t) => {
  await t.test('the caret before the cap is at its ink, as tall as the capital; after it is where the first line starts', () => {
    const { m: M, o } = setup({ text: STORY, paras: [{ dc: 3 }] });
    const lay = M.textLayout(o), c0 = M.caretAt(lay, 0), c1 = M.caretAt(lay, 1);
    near(c0.x, 0, 'before'); near(c0.y0, lay.caps[0].top, 'top'); near(c0.y1, lay.caps[0].base, 'bottom');
    near(c1.x, INSET, 'after');
    assert.equal(c0.line, 0);
  });
  await t.test('the line of an index in the cap is the first line beside it, and Home goes in front of the cap', () => {
    const { m, o } = setup({ text: STORY, paras: [{ dc: 3 }] });
    const lay = m.textLayout(o);
    assert.equal(m.lineOfIndex(lay, 0).i, 0);
    assert.equal(m.lineHome(lay, lay.lines[0]), 0);
    assert.equal(m.lineHome(lay, lay.lines[1]), lay.lines[1].start);
  });
  await t.test('a selection that takes the cap and some of the line is a rectangle each', () => {
    const { m, o } = setup({ text: STORY, paras: [{ dc: 3 }] });
    const lay = m.textLayout(o), r = plain(m.selectionRects(lay, 0, 5));
    assert.equal(r.length, 2);
    const cap = r.find(x => x.h > 20);
    near(cap.y, lay.caps[0].top, 'cap top'); near(cap.h, lay.caps[0].base - lay.caps[0].top, 'cap height');
    assert.deepEqual(plain(m.selectionRects(lay, 1, 5)).length, 1);
    assert.deepEqual(plain(m.selectionRects(lay, 0, 1)).length, 1);
  });
  await t.test('a click on the cap is in front of it or after it, whichever is nearer; beside it is in front', () => {
    const { m, o } = setup({ text: STORY, paras: [{ dc: 3 }] });
    const lay = m.textLayout(o), c = lay.caps[0], y = c.base - 5;
    assert.equal(m.indexAtPoint(lay, 1, y), 0);
    assert.equal(m.indexAtPoint(lay, c.x + c.w - 1, y), 1);
    assert.equal(m.indexAtPoint(lay, -5, y), 0);
    assert.equal(m.indexAtPoint(lay, INSET + 12, lay.lines[0].top + 5) > 1, true);   // (on the text beside it, as always)
  });
  await t.test('Up and Down from inside the cap work', () => {
    const { m, o } = setup({ text: STORY, paras: [{ dc: 3 }] });
    const lay = m.textLayout(o);
    assert.equal(m.verticalMove(lay, 0, 1, null).index, lay.lines[1].start);   // (the start of the next line, not the cap again)
    assert.equal(m.verticalMove(lay, lay.lines[1].start, -1, null).index, lay.lines[0].start);   // (Up goes to the start of the line above, which is after the cap)
  });
});

test('drawing, saving and the rest of the editor', async (t) => {
  await t.test('the cap is drawn, big, where the layout says', () => {
    const { m, o, log } = setup({ text: STORY, paras: [{ dc: 3 }] });
    log.length = 0; m.buildText(o);
    const cap = log.find(l => l.text === 'O' && l.size > 20);
    assert.ok(cap, 'the cap was drawn');
    near(cap.size, SIZE, 'size'); near(cap.x, -LSB, 'x'); near(cap.y, m.textLayout(o).caps[0].base, 'baseline');
    assert.ok(!log.some(l => l.size === 10 && /^O/.test(l.text)), 'and not again at the size of the text');
  });
  await t.test('a different cap is a different layout', () => {
    const a = setup({ text: STORY, paras: [{ dc: 3 }] }), b = setup({ text: STORY, paras: [{ dc: 4 }] }), c = setup({ text: STORY });
    assert.notEqual(a.m.layoutText(a.o).d, b.m.layoutText(b.o).d);
    assert.notEqual(a.m.layoutText(a.o).d, c.m.layoutText(c.o).d);
  });
  await t.test('the settings put on by the controls are kept in the file', () => {
    const { m, o } = setup({ text: STORY });
    assert.equal(m.applyParaSettings(o, 0, 0, { dc: 3 }), true);
    m.refresh(o);
    assert.equal(m.textLayout(o).caps.length, 1);
    const back = m.sanitizeDoc(JSON.parse(m.docJSON(m.doc))).objects.find(x => x.kind === 'text');
    assert.equal(m.textLayout(back).caps.length, 1);
  });
  await t.test('typing in the paragraph keeps its cap, and removing the line break before it moves the cap with its paragraph', () => {
    const { m, o } = setup({ text: 'aa bb\n' + STORY, paras: [{}, { dc: 3 }] });
    m.setTextValue(o, 'aa bb\nX' + STORY, undefined, 8); m.refresh(o);
    assert.equal(m.textLayout(o).caps[0].text, 'X');
    m.setTextValue(o, 'aa bb\nZ' + STORY, undefined, 7); m.refresh(o);
    assert.equal(m.textLayout(o).caps.length, 1);
  });
  await t.test('break apart gives the cap letter too, big, ahead of the line beside it', () => {
    const { m, o } = setup({ text: 'Abc def', paras: [{ dc: 3 }] });
    const r = m.breakApartText(o);
    assert.equal(r.shapes.length, 6);
    assert.equal(r.shapes[0].name, 'A');
    const small = r.shapes.find(s => s.name === 'b');
    assert.ok(r.shapes[0].h >= 0 && small);
  });
});

test('with a shape the text wraps around', async (t) => {
  await t.test('the cap sits at the left of the room the text has, beside the shape', () => {
    const { m, o } = setup({ text: STORY, paras: [{ dc: 3 }] });
    const sh = m.newShape('rect', { x: 0, y: 0, w: 30, h: 200, wrap: true, wgap: 0 });
    m.doc.objects.push(sh); m.refresh(o);
    const L = m.textLayout(o);
    near(L.caps[0].x0, 30, 'the cap is after the shape');
    near(L.lines[0].sx, 30 + INSET, 'and the lines after the cap');
  });
});
