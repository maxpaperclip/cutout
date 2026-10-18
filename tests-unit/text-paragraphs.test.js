'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');

const plain = x => JSON.parse(JSON.stringify(x));

// A monospace stand-in for a font (5 wide at size 10), as in the other text tests; a line is 10 tall
function fakeFont() {
  const forEachGlyph = (text, x, y, size, opts, cb) => { for (let i = 0; i < text.length; i++) { cb({ index: i }, x, y, size); x += size * 0.5; } return x; };
  return {
    unitsPerEm: 1000, ascender: 800, descender: -200,
    getAdvanceWidth: (text, size, opts) => forEachGlyph(text, 0, 0, size, opts, () => {}),
    forEachGlyph,
    getPath: (text, x, y) => ({ toPathData: () => 'M' + x + ' ' + y + 'Z' }),
  };
}
function setup(props) {
  const m = loadAppModules(), font = fakeFont();
  m._sandbox.fontOf = () => font;
  m._sandbox.fonts = { fake: {} };
  const o = m.newShape('text', Object.assign({ x: 0, y: 0, size: 10, lh: 1, font: 'fake' }, props));
  m.doc.objects.push(o);
  return { m, o };
}
const { m: M } = setup({ text: 'x' });   // (for the functions that need no text object)

test('where the paragraphs are', async (t) => {
  await t.test('a paragraph starts at the beginning and after each line break', () => {
    assert.deepEqual(plain(M.paraStarts('')), [0]);
    assert.deepEqual(plain(M.paraStarts('abc')), [0]);
    assert.deepEqual(plain(M.paraStarts('ab\ncd\n\ne')), [0, 3, 6, 7]);
    assert.equal(M.paraCount('ab\ncd\n'), 3);   // (an empty paragraph at the end counts)
  });
  await t.test('an index is in the paragraph its line break ends; just after the break is the next one', () => {
    const s = 'ab\ncd';
    assert.equal(M.paraIndexAt(s, 0), 0);
    assert.equal(M.paraIndexAt(s, 2), 0);   // (on the break itself)
    assert.equal(M.paraIndexAt(s, 3), 1);
    assert.equal(M.paraIndexAt(s, 5), 1);
  });
  await t.test('a selection touches every paragraph it reaches into, but not one it only ends in front of', () => {
    const s = 'ab\ncd\nef';
    assert.deepEqual(plain(M.paraRange(s, 1, 1)), { first: 0, last: 0 });
    assert.deepEqual(plain(M.paraRange(s, 1, 4)), { first: 0, last: 1 });
    assert.deepEqual(plain(M.paraRange(s, 4, 1)), { first: 0, last: 1 });   // (either way round)
    assert.deepEqual(plain(M.paraRange(s, 0, 3)), { first: 0, last: 0 });   // (ends where "cd" begins)
    assert.deepEqual(plain(M.paraRange(s, 0, 4)), { first: 0, last: 1 });
    assert.deepEqual(plain(M.paraRange(s, 3, 3)), { first: 1, last: 1 });   // (a caret there is in "cd")
    assert.deepEqual(plain(M.paraRange(s, 0, 99)), { first: 0, last: 2 });
  });
});

test('settings on paragraphs', async (t) => {
  const s = 'ab\ncd\nef';
  await t.test('they are set on the paragraphs a selection touches, and cleared with null', () => {
    let p = M.parasApply(undefined, s, 4, 4, { dc: 3 });
    assert.deepEqual(plain(p), [{}, { dc: 3 }]);
    p = M.parasApply(p, s, 0, 8, { span: 'all' });
    assert.deepEqual(plain(p), [{ span: 'all' }, { dc: 3, span: 'all' }, { span: 'all' }]);
    p = M.parasApply(p, s, 0, 8, { span: null, dc: null });
    assert.equal(p, undefined);   // nothing set: no list at all
  });
  await t.test('values are kept within their limits, and anything else is not kept', () => {
    assert.deepEqual(plain(M.parasApply(undefined, s, 0, 0, { dc: 99, dn: 0 })), [{ dc: 8, dn: 1 }]);
    assert.deepEqual(plain(M.parasApply(undefined, s, 0, 0, { dc: 2.6 })), [{ dc: 3 }]);
    assert.equal(M.parasApply(undefined, s, 0, 0, { dc: 'x', span: 'some', zip: 1 }), undefined);
  });
  await t.test('on a text object: true only when something changed', () => {
    const { o } = setup({ text: s });
    assert.equal(M.applyParaSettings(o, 4, 4, { dc: 3 }), true);
    assert.deepEqual(plain(o.paras), [{}, { dc: 3 }]);
    assert.equal(M.applyParaSettings(o, 4, 4, { dc: 3 }), false);
    assert.equal(M.applyParaSettings(o, 4, 4, { dc: null }), true);
    assert.equal(o.paras, undefined);
  });
  await t.test('the settings of the paragraph at an index', () => {
    const { o } = setup({ text: s });
    M.applyParaSettings(o, 4, 4, { dc: 4 });
    assert.deepEqual(plain(M.paraStyleAt(o, 0)), {});
    assert.deepEqual(plain(M.paraStyleAt(o, 3)), { dc: 4 });
    assert.deepEqual(plain(M.paraStyleAt(o, 8)), {});
  });
});

test('settings stay with their paragraphs while the text is edited', async (t) => {
  const A = { dc: 2 }, B = { dc: 3 }, C = { dc: 4 };
  const edit = (paras, from, to, caret) => plain(M.parasForEdit(paras, from, to, caret));
  await t.test('typing inside a paragraph changes nothing', () => {
    assert.deepEqual(edit([A, B, C], 'ab\ncd\nef', 'ab\ncxd\nef', 5), [A, B, C]);
    assert.deepEqual(edit([A, B, C], 'ab\ncd\nef', 'ab\ncd\nef'), [A, B, C]);
  });
  await t.test('nothing to keep in step when no paragraph has settings', () => {
    assert.equal(M.parasForEdit(undefined, 'ab', 'abc', 3), undefined);
  });
  await t.test('Enter in the middle of a paragraph makes two like it', () => {
    assert.deepEqual(edit([A, B, C], 'ab\ncd\nef', 'ab\nc\nd\nef', 5), [A, B, B, C]);
  });
  await t.test('Enter at the end of a paragraph makes a new one like THAT paragraph, not like the next', () => {
    // "ab" + Enter: the text is the same whether the break went in at the end of "ab" or at the start of "cd"; the caret says which
    assert.deepEqual(edit([A, B, C], 'ab\ncd\nef', 'ab\n\ncd\nef', 3), [A, A, B, C]);
    // and Enter at the start of "cd" (caret after the break) makes the new empty one above it like "cd"
    assert.deepEqual(edit([A, B, C], 'ab\ncd\nef', 'ab\n\ncd\nef', 4), [A, B, B, C]);
  });
  await t.test('Enter at the very end of the text', () => {
    assert.deepEqual(edit([A, B], 'ab\ncd', 'ab\ncd\n', 6), [A, B, B]);
  });
  await t.test('deleting a line break joins two paragraphs, which keep the first one\'s settings', () => {
    assert.deepEqual(edit([A, B, C], 'ab\ncd\nef', 'abcd\nef', 2), [A, C]);   // (Backspace at the start of "cd")
    assert.deepEqual(edit([A, B, C], 'ab\ncd\nef', 'ab\ncdef', 5), [A, B]);
    assert.deepEqual(edit([A, B, C], 'ab\ncd\nef', 'ab\ncdef'), [A, B]);   // (no caret: found by comparing)
  });
  await t.test('two empty paragraphs in a row: the caret says which break was deleted', () => {
    // "a", "", "b": the text after is the same whichever break went. Backspace at the start of "b" (caret 2) joins "" and "b"...
    assert.deepEqual(edit([A, B, C], 'a\n\nb', 'a\nb', 2), [A, B]);
    // ...and Delete at the end of "a" (caret 1) joins "a" and ""
    assert.deepEqual(edit([A, B, C], 'a\n\nb', 'a\nb', 1), [A, C]);
  });
  await t.test('a selection that spans paragraphs, replaced by a letter, leaves one paragraph', () => {
    assert.deepEqual(edit([A, B, C], 'ab\ncd\nef', 'aXf', 2), [A]);
    assert.deepEqual(edit([A, B, C], 'ab\ncd\nef', 'ab\nXf', 4), [A, B]);
  });
  await t.test('a paste with line breaks makes paragraphs like the one it went into', () => {
    assert.deepEqual(edit([A, B, C], 'ab\ncd\nef', 'ab\nc1\n2\n3d\nef', 9), [A, B, B, B, C]);
  });
  await t.test('when everything is deleted the one paragraph left has the first one\'s settings', () => {
    assert.deepEqual(edit([A, B], 'ab\ncd', '', 0), [A]);
  });
  await t.test('setTextValue keeps o.paras in step, and drops it when nothing is left set', () => {
    const { m, o } = setup({ text: 'ab\ncd' });
    m.applyParaSettings(o, 4, 4, { dc: 3 });
    m.setTextValue(o, 'ab\nxx\ncd', undefined, 6);   // ("xx" and a break typed in front of "cd": both are like it)
    assert.equal(o.text, 'ab\nxx\ncd');
    assert.deepEqual(plain(o.paras), [{}, { dc: 3 }, { dc: 3 }]);
    m.applyParaSettings(o, 0, 99, { dc: null });
    assert.equal(o.paras, undefined);
    m.setTextValue(o, 'zz', undefined, 2);
    assert.equal(o.paras, undefined);
  });
});

test('paragraph settings from a file', async (t) => {
  await t.test('only what is understood is kept, and no more than there are paragraphs', () => {
    assert.deepEqual(plain(M.sanitizeParas([{ dc: 3 }, { dc: 99, span: 'all', zip: 1 }, 'junk', { dc: 2 }], 'a\nb\nc')), [{ dc: 3 }, { dc: 8, span: 'all' }]);
    assert.equal(M.sanitizeParas([{ foo: 1 }, null], 'a\nb'), undefined);
    assert.equal(M.sanitizeParas('dc', 'a'), undefined);
    assert.equal(M.sanitizeParas(undefined, 'a'), undefined);
    assert.equal(M.sanitizeParas([{ dc: '3' }, { dc: true }, { dc: NaN }, { span: 'every' }], 'a\nb\nc\nd'), undefined);   // (not numbers, not listed words)
  });
  await t.test('they are saved with the drawing and opened again', () => {
    const { m, o } = setup({ text: 'ab\ncd\nef' });
    m.applyParaSettings(o, 3, 6, { dc: 3, span: 'all' });
    const back = m.sanitizeDoc(JSON.parse(m.docJSON(m.doc))).objects.find(x => x.kind === 'text');
    assert.deepEqual(plain(back.paras), [{}, { dc: 3, span: 'all' }]);
  });
  await t.test('a text with nothing set has no list in the file', () => {
    const { m } = setup({ text: 'ab\ncd' });
    const saved = JSON.parse(m.docJSON(m.doc)).objects.find(x => x.kind === 'text');
    assert.equal('paras' in saved, false);
  });
  await t.test('a list for a longer text than the one in the file is cut to fit it', () => {
    const { m } = setup({ text: 'ab' });
    const d = m.sanitizeDoc({ w: 100, h: 100, objects: [{ kind: 'text', text: 'ab', size: 10, font: 'fake', x: 0, y: 0, paras: [{ dc: 2 }, { dc: 3 }, { dc: 4 }] }] });
    assert.deepEqual(plain(d.objects[0].paras), [{ dc: 2 }]);
  });
});

test('the bars beside the box: which height each touched paragraph takes', async (t) => {
  // box 50 wide = 10 letters. "aaa" is one line; "bbb bbb bbb" is cut after "bbb bbb " into two; the empty one is a line; "ccc" is one
  const TEXT = 'aaa\nbbb bbb bbb\n\nccc';
  await t.test('one bar per paragraph, from the top of its first line to the bottom of its last', () => {
    const { m, o } = setup({ text: TEXT, bw: 50 });
    const lay = m.textLayout(o);
    assert.deepEqual(plain(m.paraBars(lay, o.text, 0, o.text.length)), [
      { p: 0, y0: 0, y1: 10, col: 0 }, { p: 1, y0: 10, y1: 30, col: 0 }, { p: 2, y0: 30, y1: 40, col: 0 }, { p: 3, y0: 40, y1: 50, col: 0 }]);
  });
  await t.test('a caret has the bar of its own paragraph, and a paragraph cut into two lines is still one bar', () => {
    const { m, o } = setup({ text: TEXT, bw: 50 });
    const lay = m.textLayout(o);
    assert.deepEqual(plain(m.paraBars(lay, o.text, 12, 12)), [{ p: 1, y0: 10, y1: 30, col: 0 }]);
    assert.deepEqual(plain(m.paraBars(lay, o.text, 9, 9)), [{ p: 1, y0: 10, y1: 30, col: 0 }]);   // (on the second line of it)
  });
  await t.test('a selection reaching into two paragraphs gives two bars', () => {
    const { m, o } = setup({ text: TEXT, bw: 50 });
    const lay = m.textLayout(o);
    assert.deepEqual(plain(m.paraBars(lay, o.text, 2, 6)), [{ p: 0, y0: 0, y1: 10, col: 0 }, { p: 1, y0: 10, y1: 30, col: 0 }]);
  });
  await t.test('text with no box has them too', () => {
    const { m, o } = setup({ text: 'ab\ncd' });
    assert.deepEqual(plain(m.paraBars(m.textLayout(o), o.text, 4, 4)), [{ p: 1, y0: 10, y1: 20, col: 0 }]);
  });
  await t.test('the room between paragraphs is not in a bar', () => {
    const { m, o } = setup({ text: 'ab\ncd', pspace: 1 });   // (one em = 10 more between them)
    const bars = m.paraBars(m.textLayout(o), o.text, 0, 5);
    assert.deepEqual(plain(bars), [{ p: 0, y0: 0, y1: 10, col: 0 }, { p: 1, y0: 20, y1: 30, col: 0 }]);
  });
});
