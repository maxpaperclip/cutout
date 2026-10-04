'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');

test('svg-export: strokeAttrs / styleAttrs', async (t) => {
  await t.test('no stroke means no stroke-related attributes', () => {
    const m = loadAppModules();
    const a = m.strokeAttrs({ stroke: 'none', sw: 4 });
    assert.equal(a.stroke, 'none');
    assert.equal(a['stroke-width'], undefined);
  });

  await t.test('a solid stroke sets width, join and linecap', () => {
    const m = loadAppModules();
    const a = m.strokeAttrs({ stroke: '#000000', sw: 4, join: 'round', dash: 'solid', kind: 'rect' });
    assert.equal(a.stroke, '#000000');
    assert.equal(a['stroke-width'], 4);
    assert.equal(a['stroke-linejoin'], 'round');
    assert.equal(a['stroke-dasharray'], undefined);
  });

  await t.test('a dashed stroke gets a proportional dash array', () => {
    const m = loadAppModules();
    const a = m.strokeAttrs({ stroke: '#000', sw: 2, dash: 'dashed', kind: 'rect' });
    assert.equal(a['stroke-dasharray'], '6 4');
  });

  await t.test('a dotted stroke gets round caps', () => {
    const m = loadAppModules();
    const a = m.strokeAttrs({ stroke: '#000', sw: 2, dash: 'dotted', kind: 'rect' });
    assert.equal(a['stroke-linecap'], 'round');
  });

  await t.test('styleAttrs on an image object with full opacity has no extra attrs', () => {
    const m = loadAppModules();
    const a = m.styleAttrs({ kind: 'image', opacity: 1 });
    // Cross-realm object (see note in the aabb test) - compare shape, not identity.
    assert.equal(Object.keys(a).length, 0);
  });

  await t.test('styleAttrs includes rounded opacity when partially transparent', () => {
    const m = loadAppModules();
    const a = m.styleAttrs({ kind: 'rect', fill: '#fff', stroke: 'none', sw: 1, opacity: 0.5 });
    assert.equal(a.opacity, 0.5);
  });
});

test('svg-export: shapeSpec (geometry per object kind)', async (t) => {
  await t.test('rect is drawn at its box origin and placed by a rounded translate', () => {
    const m = loadAppModules();
    const o = { kind: 'rect', x: 1.23456, y: 2, w: 100, h: 50, r: 0 };
    const spec = m.shapeSpec(o);
    assert.equal(spec.tag, 'rect');
    assert.equal(spec.a.x, undefined);
    assert.equal(spec.a.rx, null); // no rounding requested
    assert.equal(m.geomSpec(o).a.transform, 'translate(1.235 2)');
  });

  await t.test('rect with a corner radius clamps rx to half the smaller side', () => {
    const m = loadAppModules();
    const spec = m.shapeSpec({ kind: 'rect', x: 0, y: 0, w: 40, h: 100, r: 999 });
    assert.equal(spec.a.rx, 20); // clamped to half of w (the smaller side)
  });

  await t.test('ellipse produces cx/cy/rx/ry from the box', () => {
    const m = loadAppModules();
    const spec = m.shapeSpec({ kind: 'ellipse', x: 0, y: 0, w: 100, h: 40 });
    assert.equal(spec.tag, 'ellipse');
    assert.equal(spec.a.cx, 50);
    assert.equal(spec.a.cy, 20);
    assert.equal(spec.a.rx, 50);
    assert.equal(spec.a.ry, 20);
  });

  await t.test('a line is drawn as a two-point path in its box, placed by translate', () => {
    const m = loadAppModules();
    const l = m.makeLine({ x: 1, y: 2 }, { x: 3, y: 6 });
    const spec = m.geomSpec(l);
    assert.equal(spec.tag, 'path');
    assert.equal(spec.a.d, 'M0 0L2 4');
    assert.equal(spec.a.transform, 'translate(1 2)');
  });

  await t.test('an unknown/path kind falls back to a raw <path d=...>', () => {
    const m = loadAppModules();
    const spec = m.shapeSpec({ kind: 'path', d: 'M0 0L10 10Z' });
    assert.equal(spec.tag, 'path');
    assert.equal(spec.a.d, 'M0 0L10 10Z');
  });

  await t.test('a missing image record falls back to a gray placeholder rect', () => {
    const m = loadAppModules();
    const spec = m.shapeSpec({ kind: 'image', x: 0, y: 0, w: 10, h: 10, img: 'does-not-exist' });
    assert.equal(spec.tag, 'rect');
    assert.equal(spec.a.fill, '#cfd3e0');
  });
});

test('svg-export: coverScale / picGeom / picCovers', async (t) => {
  await t.test('coverScale picks the larger ratio so the photo fully covers the box', () => {
    const m = loadAppModules();
    // box is wider relative to the image than it is tall -> width ratio wins
    assert.equal(m.coverScale({ w: 200, h: 50 }, { w: 100, h: 100 }), 2);
    assert.equal(m.coverScale({ w: 50, h: 200 }, { w: 100, h: 100 }), 2);
  });

  await t.test('picCovers is true when the photo geometry fully covers the shape box', () => {
    const m = loadAppModules();
    m.images.set('pic1', { w: 100, h: 100 });
    const shape = { w: 100, h: 100, pic: { id: 'pic1', dx: 0, dy: 0, s: 1 } };
    assert.equal(m.picCovers(shape), true);
  });

  await t.test('picCovers is false when the photo is smaller than the shape', () => {
    const m = loadAppModules();
    m.images.set('pic1', { w: 20, h: 20 });
    const shape = { w: 100, h: 100, pic: { id: 'pic1', dx: 0, dy: 0, s: 1 } };
    assert.equal(m.picCovers(shape), false);
  });
});

test('svg-export: ser / buildSVG (string assembly)', async (t) => {
  await t.test('ser produces a self-closing tag and escapes attribute values', () => {
    const m = loadAppModules();
    const xml = m.ser('rect', { x: 1, width: '10"wide"' });
    assert.equal(xml, '<rect x="1" width="10&quot;wide&quot;"/>');
  });

  await t.test('ser omits null/undefined/empty attributes entirely', () => {
    const m = loadAppModules();
    const xml = m.ser('rect', { x: 1, rx: null, ry: undefined, fill: '' });
    assert.equal(xml, '<rect x="1"/>');
  });

  await t.test('buildSVG wraps output in a properly-sized <svg> with a viewBox', () => {
    const m = loadAppModules();
    const svg = m.buildSVG([], { x: 0, y: 0, w: 800, h: 600 }, 800, 600, null);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="800" height="600" viewBox="0 0 800 600">/);
    assert.match(svg, /<\/svg>$/);
  });

  await t.test('buildSVG includes a background rect only when a background color is given', () => {
    const m = loadAppModules();
    const withBg = m.buildSVG([], { x: 0, y: 0, w: 10, h: 10 }, 10, 10, '#ff0000');
    const withoutBg = m.buildSVG([], { x: 0, y: 0, w: 10, h: 10 }, 10, 10, null);
    assert.match(withBg, /fill="#ff0000"/);
    assert.doesNotMatch(withoutBg, /<rect/);
  });

  await t.test('buildSVG skips hidden objects', () => {
    const m = loadAppModules();
    const visible = m.newShape('rect', { x: 0, y: 0, w: 10, h: 10 });
    const hidden = m.newShape('rect', { x: 0, y: 0, w: 10, h: 10, hidden: true });
    const svg = m.buildSVG([visible, hidden], { x: 0, y: 0, w: 100, h: 100 }, 100, 100, null);
    // Only one <rect> for the shapes themselves (background is null here).
    const rectCount = (svg.match(/<rect/g) || []).length;
    assert.equal(rectCount, 1);
  });
});
