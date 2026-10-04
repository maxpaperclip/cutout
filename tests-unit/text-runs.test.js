'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');

const m = loadAppModules();
const plain = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const P = f => (...a) => plain(f(...a));
const normRuns = P(m.normRuns), runsApply = P(m.runsApply), runsSplice = P(m.runsSplice), runsForEdit = P(m.runsForEdit);
const runSlices = P(m.runSlices), runStyleAt = P(m.runStyleAt), sanitizeRuns = P(m.sanitizeRuns);
const txt = (text, extra) => Object.assign({ kind: 'text', text, size: 100, fill: '#000000', font: 'sans' }, extra);

test('normRuns: no differences means no runs at all', () => {
  assert.equal(normRuns([{ n: 5 }], 5), undefined);
  assert.equal(normRuns(undefined, 5), undefined);
  assert.equal(normRuns([{ n: 5, s: 1 }], 5), undefined);
});
test('normRuns: joins neighbours that look the same, trims and pads to the length', () => {
  assert.deepEqual(normRuns([{ n: 2, c: '#f00' }, { n: 3, c: '#f00' }, { n: 1 }], 8), [{ n: 5, c: '#f00' }, { n: 3 }]);
  assert.deepEqual(normRuns([{ n: 4, c: '#f00' }, { n: 9 }], 6), [{ n: 4, c: '#f00' }, { n: 2 }]);
  assert.deepEqual(normRuns([{ n: 0, c: '#f00' }, { n: 2, c: '#0f0' }], 4), [{ n: 2, c: '#0f0' }, { n: 2 }]);
});
test('runsApply: styles a part, splitting runs at the edges', () => {
  assert.deepEqual(runsApply(undefined, 6, 2, 4, { c: '#f00' }), [{ n: 2 }, { n: 2, c: '#f00' }, { n: 2 }]);
  const r = runsApply([{ n: 6, c: '#f00' }], 6, 2, 4, { s: 2 });
  assert.deepEqual(r, [{ n: 2, c: '#f00' }, { n: 2, c: '#f00', s: 2 }, { n: 2, c: '#f00' }]);
});
test('runsApply: null clears one attribute and everything joins back up', () => {
  const r = runsApply(runsApply(undefined, 6, 2, 4, { c: '#f00' }), 6, 0, 6, { c: null });
  assert.equal(r, undefined);
  assert.equal(runsApply(undefined, 6, 3, 3, { c: '#f00' }), undefined);
});
test('runSlices and runStyleAt agree', () => {
  const r = [{ n: 2 }, { n: 2, c: '#f00' }, { n: 2 }];
  assert.deepEqual(runSlices(r, 1, 5).map(p => [p.a, p.b, p.st.c]), [[1, 2, undefined], [2, 4, '#f00'], [4, 5, undefined]]);
  assert.equal(runStyleAt(r, 3).c, '#f00');
  assert.deepEqual(runStyleAt(r, 4), {});
  assert.deepEqual(runStyleAt(undefined, 0), {});
});
test('runsSplice: removing and inserting keep the other letters styled', () => {
  const r = [{ n: 2 }, { n: 2, c: '#f00' }, { n: 2 }];
  assert.deepEqual(runsSplice(r, 6, 2, 4, 0), undefined);
  assert.deepEqual(runsSplice(r, 6, 3, 3, 2, { c: '#f00' }), [{ n: 2 }, { n: 4, c: '#f00' }, { n: 2 }]);
});
test('runsForEdit: typed letters take the style of the letter before them', () => {
  const r = [{ n: 2 }, { n: 2, c: '#f00' }, { n: 2 }];
  assert.deepEqual(runsForEdit(r, 'abcdef', 'abcxdef'), [{ n: 2 }, { n: 3, c: '#f00' }, { n: 2 }]);   // inside red
  assert.deepEqual(runsForEdit(r, 'abcdef', 'abxcdef'), [{ n: 3 }, { n: 2, c: '#f00' }, { n: 2 }]);   // at the start of red: takes the letter before it (plain)
});
test('runsForEdit: a replaced selection takes the style of its first letter; start of text takes the next', () => {
  const r = [{ n: 2, c: '#f00' }, { n: 4 }];
  assert.deepEqual(runsForEdit(r, 'abcdef', 'Xcdef'), [{ n: 1, c: '#f00' }, { n: 4 }]);
  assert.deepEqual(runsForEdit(r, 'abcdef', 'Xabcdef'), [{ n: 3, c: '#f00' }, { n: 4 }]);
  assert.equal(runsForEdit(r, 'ab', ''), undefined);
});
test('runsForEdit: pending style wins for new letters only', () => {
  const r = runsForEdit(undefined, 'ab', 'abc', { c: '#0f0' });
  assert.deepEqual(r, [{ n: 2 }, { n: 1, c: '#0f0' }]);
});
test('setTextValue keeps o.runs in step, and drops them when nothing differs', () => {
  const o = txt('abcd', { runs: [{ n: 2, c: '#f00' }, { n: 2 }] });
  m.setTextValue(o, 'abXcd');
  assert.deepEqual(plain(o.runs), [{ n: 3, c: '#f00' }, { n: 2 }]);
  m.setTextValue(o, 'cd');
  assert.equal(o.runs, undefined);
  assert.equal(o.text, 'cd');
});
test('textStyleAt reports absolute styles', () => {
  const o = txt('abc', { runs: [{ n: 1 }, { n: 1, c: '#f00', s: 2, f: 'serif' }, { n: 1 }] });
  assert.deepEqual(plain(m.textStyleAt(o, 1)), { color: '#f00', size: 200, font: 'serif' });
  assert.deepEqual(plain(m.textStyleAt(o, 0)), { color: '#000000', size: 100, font: 'sans' });
});
test('applyTextStyle: a part becomes runs, the size is stored as a multiple', () => {
  const o = txt('abcd');
  assert.ok(m.applyTextStyle(o, 1, 3, { size: 150, color: '#f00' }));
  assert.deepEqual(plain(o.runs), [{ n: 1 }, { n: 2, c: '#f00', s: 1.5 }, { n: 1 }]);
  assert.equal(o.size, 100);
});
test('applyTextStyle: the whole text is the text itself and clears the runs of that attribute', () => {
  const o = txt('abcd', { grad: { x: 1 }, runs: [{ n: 1 }, { n: 2, c: '#f00', s: 2 }, { n: 1 }] });
  m.applyTextStyle(o, 0, 4, { color: '#00f' });
  assert.equal(o.fill, '#00f'); assert.equal(o.grad, undefined);
  assert.deepEqual(plain(o.runs), [{ n: 1 }, { n: 2, s: 2 }, { n: 1 }]);
  m.applyTextStyle(o, 0, 4, { size: 50 });
  assert.equal(o.size, 50); assert.equal(o.runs, undefined);   // the multiples stay as they were
});
test('applyTextStyle: an empty range does nothing; a style equal to the text own is not stored', () => {
  const o = txt('abcd');
  assert.equal(m.applyTextStyle(o, 2, 2, { color: '#f00' }), false);
  m.applyTextStyle(o, 1, 3, { color: '#000000', font: 'sans', size: 100 });
  assert.equal(o.runs, undefined);
});
test('applyWholeStyle: also works for a text with no letters, and clears letters set apart', () => {
  const o = txt('', { grad: { x: 1 } });
  m.applyWholeStyle(o, { color: '#f00', size: 20, font: 'serif' });
  assert.equal(o.fill, '#f00'); assert.equal(o.size, 20); assert.equal(o.font, 'serif'); assert.equal(o.grad, undefined);
  const p = txt('abc', { runs: [{ n: 1 }, { n: 2, f: 'serif', c: '#0f0' }] });
  m.applyWholeStyle(p, { font: 'mono' });
  assert.equal(p.font, 'mono');
  assert.deepEqual(plain(p.runs), [{ n: 1 }, { n: 2, c: '#0f0' }]);
});
test('textUsesFont and textFonts see the faces in runs', () => {
  const o = txt('ab', { runs: [{ n: 1, f: 'serif' }, { n: 1 }] });
  assert.ok(m.textUsesFont(o, 'serif')); assert.ok(m.textUsesFont(o, 'sans')); assert.ok(!m.textUsesFont(o, 'mono'));
  assert.deepEqual(plain(m.textFonts(o)).sort(), ['sans', 'serif']);
});
test('sanitizeRuns keeps only what it understands', () => {
  const ok = f => f === 'serif';
  assert.equal(sanitizeRuns('x', 3, ok), undefined);
  assert.deepEqual(sanitizeRuns([{ n: 1, c: 'javascript:1', s: 'big', f: 'nope' }, { n: 2, c: '#F00', s: 9999, f: 'serif' }, null, { n: -4, c: '#fff' }], 3, ok),
    [{ n: 1 }, { n: 2, c: '#F00', s: 300, f: 'serif' }]);
});
