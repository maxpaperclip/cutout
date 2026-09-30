'use strict';
// Tests for the data-model cleanup: saved drawings leave out derived data, and everything
// that was rebuilt comes back the same.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCutoutModules } = require('./harness');

test('derived outlines are not saved', async (t) => {
  await t.test('docJSON drops each object\'s outline but keeps a plain shape\'s own path', () => {
    const m = loadCutoutModules();
    const d = m.blankDoc();
    d.objects.push(m.newShape('polygon', { sides: 5, star: true }));
    d.objects.push(m.newShape('path', { w: 50, h: 50, nat: { d: 'M0 0L100 0L100 100Z', w: 100, h: 100 } }));
    const back = JSON.parse(m.docJSON(d));
    assert.equal(back.objects[0].d, undefined);
    assert.equal(back.objects[1].d, undefined);
    assert.equal(back.objects[1].nat.d, 'M0 0L100 0L100 100Z');
  });

  await t.test('rebuildOutlines brings back exactly the same outlines', () => {
    const m = loadCutoutModules();
    const d = m.blankDoc();
    d.objects.push(m.newShape('polygon', { sides: 7, w: 80, h: 60 }));
    d.objects.push(m.newShape('path', { w: 50, h: 25, nat: { d: 'M0 0C30 0 70 100 100 100', w: 100, h: 100 } }));
    d.objects.push(m.newShape('text', { text: 'Hi' }));
    const before = d.objects.map((o) => o.d);
    const back = JSON.parse(m.docJSON(d));
    m.rebuildOutlines(back);
    assert.deepEqual(JSON.parse(JSON.stringify(back.objects.map((o) => o.d))), JSON.parse(JSON.stringify(before)));
  });
});

test('shared field lists', async (t) => {
  await t.test('copyKeys copies, removes what the source lacks, and never shares a gradient', () => {
    const m = loadCutoutModules();
    const a = m.newShape('rect', { fill: '#ff0000', grad: m.makeGrad('linear'), blend: 'multiply' });
    const b = m.newShape('rect', { fill: '#00ff00', cap: 'round' });
    m.copyKeys(a, b, m.STYLE_KEYS);
    assert.equal(b.fill, '#ff0000');
    assert.equal(b.blend, 'multiply');
    assert.equal(b.cap, undefined);
    assert.notEqual(b.grad, a.grad);
    assert.equal(JSON.stringify(b.grad), JSON.stringify(a.grad));
  });

  await t.test('toPlainPath removes every kind\'s own settings', () => {
    const m = loadCutoutModules();
    const t0 = m.newShape('text', { text: 'Hi' });
    m.toPlainPath(t0, 'M0 0L1 1', 10, 10);
    assert.equal(t0.kind, 'path');
    for (const k of ['text', 'font', 'size', 'align', 'lh', 'ls']) assert.equal(t0[k], undefined, k);
    assert.deepEqual(JSON.parse(JSON.stringify(t0.nat)), { d: 'M0 0L1 1', w: 10, h: 10 });
  });

  await t.test('makeImage fills in the usual photo fields', () => {
    const m = loadCutoutModules();
    const im = m.makeImage({ id: 'abc', w: 40, h: 20, name: 'Cat' }, { x: 5, rot: 10 });
    assert.equal(im.kind, 'image');
    assert.equal(im.img, 'abc');
    assert.equal(im.name, 'Cat');
    assert.deepEqual([im.x, im.y, im.w, im.h, im.rot, im.opacity], [5, 0, 40, 20, 10, 1]);
  });

  await t.test('Combine gives the result every style setting of the bottom shape', () => {
    const m = loadCutoutModules();
    const a = m.newShape('rect', { x: 0, y: 0, w: 50, h: 50, fill: '#123456', stroke: '#abcdef', sw: 7, opacity: 0.5, join: 'round', dash: 'dashed', cap: 'square', blend: 'screen' });
    const b = m.newShape('rect', { x: 25, y: 25, w: 50, h: 50 });
    const r = m.combineShapes('unite', [a, b]);
    for (const k of m.STYLE_KEYS) assert.equal(JSON.stringify(r[k]), JSON.stringify(a[k]), k);
  });
});

test('what each kind can do (KIND_INFO)', async (t) => {
  await t.test('photos are pixels: no fill, outline or gradient, and they keep their proportions', () => {
    const m = loadCutoutModules();
    const im = { kind: 'image', img: 'x' }, r = { kind: 'rect' }, tx = { kind: 'text' };
    assert.equal(m.hasPixels(im), true);
    assert.equal(m.hasPaint(im), false);
    assert.equal(m.hasPaint(r), true);
    assert.equal(m.keepsRatio(im), true);
    assert.equal(m.keepsRatio(tx), true);
    assert.equal(m.keepsRatio(r), false);
  });

  await t.test('every kind has a label, and plain shapes are already plain', () => {
    const m = loadCutoutModules();
    for (const k of Object.keys(m.KIND_INFO)) assert.ok(m.KIND_INFO[k].label, k);
    assert.equal(!!m.kindInfo({ kind: 'path' }).plain, false);
    assert.equal(m.kindInfo({ kind: 'nonsense' }).label, undefined);
  });
});
