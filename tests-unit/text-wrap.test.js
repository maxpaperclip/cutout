'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');

// Arrays made inside the vm have its own Array, which deepEqual treats as a different kind of thing
const plain = x => JSON.parse(JSON.stringify(x));

/*
 * A monospace stand-in for an opentype font: every character is half the font size wide (plus letter spacing).
 * The tests use size 10, so a character is 5 wide, with the default line height 1.2 turned to 1 (a slot is 10 tall).
 * `log` records what getPath was asked to draw.
 */
function fakeFont({ log } = {}) {
  const step = (size, opts) => size * 0.5 + ((opts && opts.letterSpacing) || 0) * size;
  const forEachGlyph = (text, x, y, size, opts, cb) => {
    for (let i = 0; i < text.length; i++) { cb({ index: i }, x, y, size); x += step(size, opts); }
    return x;
  };
  return {
    unitsPerEm: 1000, ascender: 800, descender: -200,
    getAdvanceWidth: (text, size, opts) => forEachGlyph(text, 0, 0, size, opts, () => {}),
    forEachGlyph,
    getPath: (text, x, y, size, opts) => { if (log) log.push({ text, x, y, size }); return { toPathData: () => 'P' + text + ';' }; },
  };
}
function setup(props, font) {
  const m = loadAppModules();
  m._sandbox.fontOf = () => font || fakeFont();
  m._sandbox.fonts = { fake: {} };   // the fonts a drawing may name when it is opened (sanitizeDoc)
  const o = m.newShape('text', Object.assign({ x: 0, y: 0, size: 10, lh: 1, font: 'fake' }, props));
  return { m, o, lay: () => m.textLayout(o) };
}
const xsOf = t => Array.from({ length: t.length + 1 }, (_, i) => i * 5);   // 5 wide each

test('wrapping: where a paragraph is cut (breakLines)', async (t) => {
  const { m } = setup({});
  const cut = (text, bw) => plain(m.breakLines(text, xsOf(text), bw));
  await t.test('a paragraph that fits is one line', () => { assert.deepEqual(cut('hello world', 55), [11]); });
  await t.test('it is cut after the last word that fits, keeping the space on that line', () => {
    assert.deepEqual(cut('hello world', 50), [6, 11]);
    assert.deepEqual(cut('aaa bbb ccc', 35), [8, 11]);   // "aaa bbb" is exactly 35 wide
  });
  await t.test('spaces at the end of a line do not count toward its width', () => {
    assert.deepEqual(cut('ab   cd', 10), [5, 7]);
  });
  await t.test('a word too long for a line is cut where the box is full', () => {
    assert.deepEqual(cut('abcdefghij', 20), [4, 8, 10]);
    assert.deepEqual(cut('abcd', 20), [4]);
  });
  await t.test('a long word that follows a short one starts a line of its own first', () => {
    assert.deepEqual(cut('aa bbbbbbbb', 25), [3, 8, 11]);
  });
  await t.test('a hyphen or dash inside a word is a place to cut', () => {
    assert.deepEqual(cut('well-known', 25), [5, 10]);
    assert.deepEqual(cut('one—two', 20), [4, 7]);   // "one—" is 4 wide
  });
  await t.test('every line has a character, however narrow the box', () => {
    assert.deepEqual(cut('ab', 1), [1, 2]);
    assert.deepEqual(cut('abc', 0), [1, 2, 3]);
  });
  await t.test('text with no spaces (Chinese, say) wraps by the character', () => {
    assert.deepEqual(cut('你好世界你好', 15), [3, 6]);
  });
  await t.test('a letter is never parted from its accent, nor a pair of units split', () => {
    assert.deepEqual(cut('aébc', 10), [1, 3, 5]);
    const wide = '\u{1D538}\u{1D539}\u{1D53A}';   // three characters of two units each
    const ends = cut(wide, 20);
    assert.ok(ends.every(e => e % 2 === 0));
  });
  await t.test('an empty paragraph has no cuts', () => { assert.deepEqual(cut('', 10), []); });
});

test('wrapping: the layout of area text', async (t) => {
  await t.test('lines, their indexes and where they end', () => {
    const { lay } = setup({ text: 'aaa bbb ccc', bw: 35 });
    const L = lay();
    assert.deepEqual(plain(L.lines.map(l => l.text)), ['aaa bbb ', 'ccc']);
    assert.deepEqual(plain(L.lines.map(l => [l.start, l.end])), [[0, 8], [8, 11]]);   // a wrap leaves no gap between lines
    assert.deepEqual(plain(L.lines.map(l => l.hard)), [false, true]);
    assert.equal(L.lines[0].tw, 35);       // "aaa bbb" without the space hanging at its end
    assert.equal(L.lines[0].cend, 7);      // the caret stops before that space
    assert.equal(L.lines[1].cend, 11);
    assert.equal(L.w, 35); assert.equal(L.h, 20); assert.equal(L.area, true);
  });
  await t.test('the box is as wide as asked, not as wide as the text', () => {
    assert.equal(setup({ text: 'ab', bw: 100 }).lay().w, 100);
    assert.equal(setup({ text: 'ab' }).lay().w, 10);   // point text: as wide as its text
  });
  await t.test('a line break starts a new paragraph, one index on; soft and hard lines mix', () => {
    const L = setup({ text: 'aaa bbb\n\nccc', bw: 20 }).lay();
    assert.deepEqual(plain(L.lines.map(l => l.text)), ['aaa ', 'bbb', '', 'ccc']);
    assert.deepEqual(plain(L.lines.map(l => l.start)), [0, 4, 8, 9]);
    assert.deepEqual(plain(L.lines.map(l => l.hard)), [false, true, true, true]);
  });
  await t.test('alignment ignores the spaces hanging at the end of a line', () => {
    const base = { text: 'aaa bbb ccc', bw: 35 };
    const right = setup(Object.assign({ align: 'right' }, base)).lay(), center = setup(Object.assign({ align: 'center' }, base)).lay();
    assert.deepEqual(plain(right.lines.map(l => l.x)), [0, 20]);     // "aaa bbb" fills the box; "ccc" is 15 wide
    assert.deepEqual(plain(center.lines.map(l => l.x)), [0, 10]);
  });
  await t.test('point text is untouched: no wrapping, spaces counted', () => {
    const L = setup({ text: 'aaa bbb ccc  ', align: 'right' }).lay();
    assert.equal(L.lines.length, 1);
    assert.equal(L.lines[0].hard, true);
    assert.equal(L.lines[0].tw, L.lines[0].m.width);
    assert.equal(L.lines[0].x, 0);
    assert.equal(L.area, false);
  });
  await t.test('a text with nothing in it is one empty line', () => {
    const L = setup({ text: '', bw: 50 }).lay();
    assert.equal(L.lines.length, 1);
    assert.equal(L.w, 50);
  });
  await t.test('letters of another size wrap by their own widths', () => {
    const { o, m } = setup({ text: 'aaa bbb', bw: 40 });
    o.runs = [{ n: 4 }, { n: 3, s: 2 }];   // "bbb" at twice the size: 10 wide each
    const L = m.textLayout(o);
    assert.deepEqual(plain(L.lines.map(l => l.text)), ['aaa ', 'bbb']);   // 15 + 30 would not fit in 40
    assert.equal(L.lines[1].segs[0].size, 20);
  });
  await t.test('the outline is drawn line by line where the layout put them', () => {
    const log = [];
    const { o, m } = setup({ text: 'aaa bbb', bw: 20 }, fakeFont({ log }));
    log.length = 0; m.buildText(o);
    assert.deepEqual(plain(log.map(l => [l.text, l.x, l.y])), [['aaa ', 0, 8], ['bbb', 0, 18]]);
  });
  await t.test('refresh gives the box its width and the height of its lines', () => {
    const { o, m } = setup({ text: 'aaa bbb ccc', bw: 35 });
    assert.equal(o.w, 35); assert.equal(o.h, 20);
    o.bw = 100; m.refresh(o);   // the same text at another width is not taken from the old layout
    assert.equal(o.w, 100); assert.equal(o.h, 10);
  });
});

test('wrapping: caret, selection and clicks on wrapped lines', async (t) => {
  await t.test('an index at a wrap is the start of the next line', () => {
    const { m, lay } = setup({ text: 'aaa bbb', bw: 20 });
    const L = lay();
    assert.equal(m.lineOfIndex(L, 4).i, 1);
    assert.equal(m.caretAt(L, 4).x, 0);
    assert.equal(m.caretAt(L, 4).line, 1);
    assert.equal(m.caretAt(L, 3).line, 0);     // just after "aaa"
    assert.equal(m.caretAt(L, 3).x, 15);
  });
  await t.test('a selection across a wrap is not given a mark for a line break that is not there', () => {
    const { m, lay } = setup({ text: 'aaa bbb', bw: 20 });
    const r = plain(m.selectionRects(lay(), 0, 6));
    assert.deepEqual(r.map(q => [q.x, q.w]), [[0, 20], [0, 10]]);
  });
  await t.test('a selection across a real line break still is', () => {
    const { m, lay } = setup({ text: 'aaa\nbbb', bw: 100 });
    const r = plain(m.selectionRects(lay(), 0, 5));
    assert.equal(r[0].w, 15 + 2.5);   // "aaa" and the mark for its break (a quarter of the size)
  });
  await t.test('a click past the end of a wrapped line lands after its last word, on that line', () => {
    const { m, lay } = setup({ text: 'aaa bbb', bw: 20 });
    const L = lay();
    assert.equal(m.indexAtPoint(L, 500, 2), 3);
    assert.equal(m.indexAtPoint(L, 500, 12), 7);   // the last line ends at the end
    assert.equal(m.indexAtPoint(L, 17, 2), 3);     // nearest the gap after "aaa", not the one after the space
    assert.equal(m.indexAtPoint(L, 7, 12), 5);
  });
  await t.test('Up and Down keep to the same column', () => {
    const { m, lay } = setup({ text: 'aaa bbb ccc', bw: 35 });
    const L = lay();
    assert.equal(m.verticalMove(L, 2, 1, null).index, 10);   // column 2 of "ccc" is 8 + 2
    assert.equal(m.verticalMove(L, 10, -1, null).index, 2);
  });
});

test('wrapping: the box in the rest of the editor', async (t) => {
  await t.test('a drawing keeps the width of a text box when it is saved and opened', () => {
    const { m, o } = setup({ text: 'aaa bbb ccc', bw: 35 });
    m.doc.objects.push(o);
    const back = m.sanitizeDoc(JSON.parse(m.docJSON(m.doc)));
    assert.equal(back.objects[0].bw, 35);
    assert.equal(back.objects[0].w, 35);
    assert.equal(back.objects[0].h, 20);
  });
  await t.test('a width that makes no sense is not kept: the text goes back to point text', () => {
    const { m } = setup({});
    [0, -5, 'wide', null].forEach(bw => {
      const d = m.sanitizeDoc({ w: 800, h: 600, objects: [{ kind: 'text', text: 'aaa bbb', size: 10, font: 'fake', bw, x: 0, y: 0 }] });
      assert.equal(d.objects[0].bw, undefined, String(bw));
    });
    const huge = m.sanitizeDoc({ w: 800, h: 600, objects: [{ kind: 'text', text: 'aaa', size: 10, font: 'fake', bw: 1e9, x: 0, y: 0 }] });
    assert.equal(huge.objects[0].bw, 1e5);
  });
  await t.test('a plain text saved with no box is still point text', () => {
    const { m, o } = setup({ text: 'aaa bbb' });
    assert.equal(o.bw, undefined);
    assert.equal(m.sanitizeDoc(JSON.parse(m.docJSON({ w: 800, h: 600, objects: [o], groups: [], nextId: 5 }))).objects[0].bw, undefined);
  });
  await t.test('scaling a group scales the box with the letters, so the words wrap the same', () => {
    const { m, o } = setup({ text: 'aaa bbb ccc', bw: 35 });
    const o0 = JSON.parse(JSON.stringify(o));
    m.scaleAbout(o, o0, 0, 0, 2);
    assert.equal(o.size, 20); assert.equal(o.bw, 70);
    assert.deepEqual(plain(m.textLayout(o).lines.map(l => l.text)), ['aaa bbb ', 'ccc']);
    assert.equal(o.w, 70); assert.equal(o.h, 40);
  });
  await t.test('Convert to plain shape leaves no box width behind', () => {
    const { m, o } = setup({ text: 'aaa bbb', bw: 20 });
    m.doc.objects.push(o); m.S.sel = new Set([o.id]);
    m.flattenSelected();
    assert.equal(o.kind, 'path');
    assert.equal(o.bw, undefined);
  });
  await t.test('Break apart follows the lines as wrapped', () => {
    const m = loadAppModules({ recordToasts: true });
    m._sandbox.fontOf = () => ({
      unitsPerEm: 1000, ascender: 800, descender: -200,
      getAdvanceWidth: (text, size) => text.length * size * 0.5,
      forEachGlyph: (text, x, y, size, opts, cb) => { for (let i = 0; i < text.length; i++) { cb({ index: i }, x, y, size); x += size * 0.5; } return x; },
      getPath: (text, x, y, size) => {
        let d = ''; for (let i = 0; i < text.length; i++) if (text[i] !== ' ') d += 'M' + (x + i * size * 0.5) + ' ' + (y - size * 0.7) + 'L' + (x + i * size * 0.5 + size * 0.4) + ' ' + (y - size * 0.7) + 'L' + (x + i * size * 0.5 + size * 0.4) + ' ' + y + 'L' + (x + i * size * 0.5) + ' ' + y + 'Z';
        return { toPathData: () => d };
      },
    });
    const o = m.newShape('text', { x: 0, y: 0, size: 10, lh: 1, font: 'fake', text: 'aaa bbb', bw: 20 });
    const r = m.breakApartText(o);
    assert.equal(r.shapes.length, 6);
    assert.deepEqual(plain(r.shapes.map(s => s.y)).slice(0, 4), [1, 1, 1, 11]);   // "aaa" on the first line, "bbb" a line (10) below
    assert.ok(r.shapes[3].x < 1);   // and the second line starts at the box's left edge
  });
});
