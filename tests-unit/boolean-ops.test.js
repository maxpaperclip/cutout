'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');

test('boolean-ops: combineShapes unite', async (t) => {
  await t.test('uniting two overlapping rects gives a single path bounding both', () => {
    const m = loadAppModules();
    const a = m.newShape('rect', { x: 0, y: 0, w: 100, h: 100 });
    const b = m.newShape('rect', { x: 50, y: 50, w: 100, h: 100 });
    const result = m.combineShapes('unite', [a, b]);

    assert.equal(result.kind, 'path');
    assert.equal(result.x, 0);
    assert.equal(result.y, 0);
    assert.equal(result.w, 150);
    assert.equal(result.h, 150);
    assert.equal(result.name, 'United shape');
  });

  await t.test('the combined shape keeps the bottom (first) shape\'s style', () => {
    const m = loadAppModules();
    const a = m.newShape('rect', { x: 0, y: 0, w: 100, h: 100, fill: '#ff0000' });
    const b = m.newShape('rect', { x: 50, y: 50, w: 100, h: 100, fill: '#00ff00' });
    const result = m.combineShapes('unite', [a, b]);
    assert.equal(result.fill, '#ff0000');
  });

  await t.test('uniting three shapes combines them all', () => {
    const m = loadAppModules();
    const a = m.newShape('rect', { x: 0, y: 0, w: 50, h: 50 });
    const b = m.newShape('rect', { x: 40, y: 0, w: 50, h: 50 });
    const c = m.newShape('rect', { x: 80, y: 0, w: 50, h: 50 });
    const result = m.combineShapes('unite', [a, b, c]);
    assert.equal(result.w, 130);
    assert.equal(result.h, 50);
  });
});

test('boolean-ops: combineShapes subtract/intersect/exclude', async (t) => {
  await t.test('subtract removes the second shape from the first', () => {
    const m = loadAppModules();
    const a = m.newShape('rect', { x: 0, y: 0, w: 100, h: 100 });
    const b = m.newShape('rect', { x: 50, y: 0, w: 100, h: 100 });
    const result = m.combineShapes('subtract', [a, b]);
    // What's left of `a` after cutting out `b` is its left half.
    assert.equal(result.x, 0);
    assert.equal(result.w, 50);
    assert.equal(result.h, 100);
  });

  await t.test('intersect keeps only the overlapping region', () => {
    const m = loadAppModules();
    const a = m.newShape('rect', { x: 0, y: 0, w: 100, h: 100 });
    const b = m.newShape('rect', { x: 50, y: 50, w: 100, h: 100 });
    const result = m.combineShapes('intersect', [a, b]);
    assert.equal(result.x, 50);
    assert.equal(result.y, 50);
    assert.equal(result.w, 50);
    assert.equal(result.h, 50);
  });

  await t.test('exclude removes the overlap, leaving both non-overlapping parts', () => {
    const m = loadAppModules();
    const a = m.newShape('rect', { x: 0, y: 0, w: 100, h: 100 });
    const b = m.newShape('rect', { x: 50, y: 50, w: 100, h: 100 });
    const result = m.combineShapes('exclude', [a, b]);
    // Overall bounds still span both original rects...
    assert.equal(result.w, 150);
    assert.equal(result.h, 150);
    // ...but the shape is not simply-connected/filled like a unite would be,
    // so its path data should describe more than one sub-path.
    const subpaths = (result.nat.d.match(/M/g) || []).length;
    assert.ok(subpaths >= 2, `expected exclude to produce multiple sub-paths, got d="${result.nat.d}"`);
  });
});

test('boolean-ops: edge cases', async (t) => {
  await t.test('intersecting two shapes that do not overlap returns null and shows a toast', () => {
    const m = loadAppModules({ recordToasts: true });
    const a = m.newShape('rect', { x: 0, y: 0, w: 10, h: 10 });
    const b = m.newShape('rect', { x: 1000, y: 1000, w: 10, h: 10 });
    const result = m.combineShapes('intersect', [a, b]);
    assert.equal(result, null);
    assert.ok(m._toasts.length > 0);
  });

  await t.test('subtracting a shape that fully covers the first leaves nothing and returns null', () => {
    const m = loadAppModules({ recordToasts: true });
    const a = m.newShape('rect', { x: 10, y: 10, w: 10, h: 10 });
    const big = m.newShape('rect', { x: 0, y: 0, w: 1000, h: 1000 });
    const result = m.combineShapes('subtract', [a, big]);
    assert.equal(result, null);
    assert.ok(m._toasts.length > 0);
  });

  await t.test('combining with a straight line is refused and explained, like any open line', () => {
    const m = loadAppModules({ recordToasts: true });
    const a = m.newShape('rect', { x: 0, y: 0, w: 100, h: 100 });
    const line = m.makeLine({ x: 10, y: 10 }, { x: 90, y: 90 });
    m.doc.objects.push(a, line);
    m.S.sel = new Set([a.id, line.id]);
    assert.doesNotThrow(() => m.runBoolean('unite'));
    assert.equal(m.doc.objects.length, 2);
    assert.match(m._toasts.join(' '), /no inside/);
  });
});

test('boolean-ops: replaceObjects', async (t) => {
  await t.test('replaces the combined shapes with the result, keeping stacking position', () => {
    const m = loadAppModules();
    const a = m.newShape('rect', { x: 0, y: 0, w: 10, h: 10 });
    const b = m.newShape('rect', { x: 5, y: 5, w: 10, h: 10 });
    const other = m.newShape('rect', { x: 100, y: 100, w: 10, h: 10 });
    m.doc.objects.push(a, b, other);

    const result = m.combineShapes('unite', [a, b]);
    m.replaceObjects([a, b], result);

    assert.equal(m.doc.objects.length, 2);
    assert.ok(m.doc.objects.includes(other));
    assert.ok(m.doc.objects.includes(result));
    assert.equal(m.doc.objects.indexOf(result), 0, 'result should take the place of the bottom-most combined shape');
  });

  await t.test('selects only the new result object', () => {
    const m = loadAppModules();
    const a = m.newShape('rect', { x: 0, y: 0, w: 10, h: 10 });
    const b = m.newShape('rect', { x: 5, y: 5, w: 10, h: 10 });
    m.doc.objects.push(a, b);
    const result = m.combineShapes('unite', [a, b]);
    m.replaceObjects([a, b], result);

    assert.equal(m.S.sel.size, 1);
    assert.ok(m.S.sel.has(result.id));
  });
});

test('boolean-ops: runBoolean (the full user-facing action)', async (t) => {
  await t.test('does nothing and toasts when fewer than two shapes are selected', () => {
    const m = loadAppModules({ recordToasts: true });
    const a = m.newShape('rect', { x: 0, y: 0, w: 10, h: 10 });
    m.doc.objects.push(a);
    m.S.sel = new Set([a.id]);

    m.runBoolean('unite');

    assert.equal(m.doc.objects.length, 1, 'nothing should be combined');
    assert.ok(m._toasts.some((msg) => /select two or more/i.test(msg)));
  });

  await t.test('refuses to combine a photo like a plain shape', () => {
    const m = loadAppModules({ recordToasts: true });
    const photo = { id: 1, kind: 'image', x: 0, y: 0, w: 10, h: 10 };
    const rect = m.newShape('rect', { x: 0, y: 0, w: 10, h: 10 });
    m.doc.objects.push(photo, rect);
    m.S.sel = new Set([photo.id, rect.id]);

    m.runBoolean('unite');

    assert.equal(m.doc.objects.length, 2, 'nothing should be combined');
    assert.ok(m._toasts.some((msg) => /photos.*can.*t be combined/i.test(msg)));
  });

  await t.test('combining two selected shapes reduces the document by one object and commits', () => {
    const m = loadAppModules({ recordToasts: true });
    const a = m.newShape('rect', { x: 0, y: 0, w: 100, h: 100 });
    const b = m.newShape('rect', { x: 50, y: 50, w: 100, h: 100 });
    m.doc.objects.push(a, b);
    m.S.sel = new Set([a.id, b.id]);

    m.runBoolean('unite');

    assert.equal(m.doc.objects.length, 1);
    assert.equal(m._commits.length, 1, 'runBoolean should commit exactly one history entry');
  });
});
