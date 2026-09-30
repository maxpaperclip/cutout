'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCutoutModules } = require('./harness');

// A wavy line, and a lumpy circle that ends back where it started (page coordinates)
const wave = (n = 60) => Array.from({ length: n }, (_, i) => ({ x: 100 + i * 8, y: 200 + 40 * Math.sin(i / 6) }));
const loop = (n = 72) => Array.from({ length: n + 1 }, (_, i) => { const a = i / n * 2 * Math.PI, r = 100 + 15 * Math.sin(a * 5); return { x: 300 + r * Math.cos(a), y: 300 + r * Math.sin(a) }; });
const curves = (d) => (d.match(/[CcLl]/g) || []).length;

test('pencil: smoothing a freehand stroke', async (t) => {
  await t.test('a wavy stroke becomes a few smooth curves, left open', () => {
    const m = loadCutoutModules();
    const g = m.pencilGeometry(wave(), 1);
    assert.equal(g.closed, false);
    assert.ok(curves(g.d) > 0 && curves(g.d) < 15, 'expected a handful of curves, got ' + curves(g.d));
    assert.doesNotMatch(g.d, /[Zz]/);
    assert.equal(m.pathIsOpen(g.d), true);
  });

  await t.test('the box fits the stroke and the path is drawn inside it', () => {
    const m = loadCutoutModules();
    const g = m.pencilGeometry(wave(), 1);
    assert.ok(Math.abs(g.x - 100) < 1 && Math.abs(g.w - 472) < 2, 'box ' + g.x + ' ' + g.w);
    assert.ok(g.y > 158 && g.y < 162);
    assert.match(g.d, /^M0[ ,]/);   // starts at the left edge of its own box
  });

  await t.test('a stroke that ends where it began closes into a loop', () => {
    const m = loadCutoutModules();
    const g = m.pencilGeometry(loop(), 1);
    assert.equal(g.closed, true);
    assert.match(g.d, /[Zz]$/);
    assert.equal(m.pathIsOpen(g.d), false);
    assert.ok(Math.abs(g.w - g.h) < 20);
  });

  await t.test('closing depends on the gap as seen on screen, so zooming in makes it stricter', () => {
    const m = loadCutoutModules();
    const pts = loop(); pts[pts.length - 1] = { x: pts[0].x + 10, y: pts[0].y };   // a 10-unit gap
    assert.equal(m.pencilGeometry(pts, 1).closed, true);    // 10 screen px: close enough
    assert.equal(m.pencilGeometry(pts, 4).closed, false);   // 40 screen px: not closed
  });

  await t.test('a short scribble that returns to its start is not treated as a loop', () => {
    const m = loadCutoutModules();
    const pts = [{ x: 0, y: 0 }, { x: 8, y: 2 }, { x: 10, y: 6 }, { x: 4, y: 7 }, { x: 1, y: 1 }];
    assert.equal(m.pencilGeometry(pts, 1).closed, false);
  });

  await t.test('a click or a tiny wiggle makes nothing', () => {
    const m = loadCutoutModules();
    assert.equal(m.pencilGeometry([{ x: 5, y: 5 }], 1), null);
    assert.equal(m.pencilGeometry([{ x: 5, y: 5 }, { x: 5.5, y: 5 }, { x: 6, y: 5.5 }], 1), null);
  });

  await t.test('a perfectly straight stroke still gets a usable box', () => {
    const m = loadCutoutModules();
    const g = m.pencilGeometry([{ x: 0, y: 50 }, { x: 40, y: 50 }, { x: 80, y: 50 }], 1);
    assert.ok(g.h > 0 && g.w > 79);
  });
});

test('pencil: open paths', async (t) => {
  await t.test('pathIsOpen checks every part of a path', () => {
    const m = loadCutoutModules();
    assert.equal(m.pathIsOpen('M0 0L10 0L10 10Z'), false);
    assert.equal(m.pathIsOpen('M0 0L10 0L10 10'), true);
    assert.equal(m.pathIsOpen('M0 0L10 0L10 10ZM20 20L30 30'), true);
    assert.equal(m.pathIsOpen('M0 0L10 0Zm5 5l1 1z'), false);
    assert.equal(m.pathIsOpen(''), false);
    assert.equal(m.pathIsOpen(undefined), false);
  });

  await t.test('shapes and text are never open; drawn lines get round ends', () => {
    const m = loadCutoutModules();
    assert.equal(m.isOpenPath(m.newShape('polygon', {})), false);
    assert.equal(m.isOpenPath(m.newShape('rect', {})), false);
    const g = m.pencilGeometry(wave(), 1);
    const o = m.newShape('path', { x: g.x, y: g.y, w: g.w, h: g.h, nat: { d: g.d, w: g.w, h: g.h }, fill: 'none', stroke: '#000000', sw: 3 });
    assert.equal(m.isOpenPath(o), true);
    assert.equal(m.strokeAttrs(o)['stroke-linecap'], 'round');
  });

  await t.test('a drawn line stays open after resizing', () => {
    const m = loadCutoutModules();
    const g = m.pencilGeometry(wave(), 1);
    const o = m.newShape('path', { x: g.x, y: g.y, w: g.w, h: g.h, nat: { d: g.d, w: g.w, h: g.h }, fill: 'none', stroke: '#000000' });
    o.w *= 2; o.h *= 0.5; m.refresh(o);
    assert.equal(m.isOpenPath(o), true);
  });

  await t.test('combining with an open drawn line is refused and explained', () => {
    const m = loadCutoutModules({ recordToasts: true });
    const g = m.pencilGeometry(wave(), 1);
    const line = m.newShape('path', { x: g.x, y: g.y, w: g.w, h: g.h, nat: { d: g.d, w: g.w, h: g.h }, fill: 'none', stroke: '#000000' });
    const rect = m.newShape('rect', { x: 100, y: 150, w: 100, h: 100 });
    m.doc.objects.push(rect, line);
    m.S.sel = new Set([rect.id, line.id]);
    m.runBoolean('unite');
    assert.equal(m.doc.objects.length, 2);
    assert.match(m._toasts.join(' '), /no inside/);
  });

  await t.test('a closed drawn loop combines like any shape', () => {
    const m = loadCutoutModules();
    const g = m.pencilGeometry(loop(), 1);
    const blob = m.newShape('path', { x: g.x, y: g.y, w: g.w, h: g.h, nat: { d: g.d, w: g.w, h: g.h } });
    const rect = m.newShape('rect', { x: 300, y: 300, w: 200, h: 200 });
    assert.ok(m.combineShapes('unite', [blob, rect]));
  });
});
