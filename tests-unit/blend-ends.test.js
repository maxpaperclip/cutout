'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');

const outline = (extra) => Object.assign({ kind: 'rect', stroke: '#000000', sw: 2, dash: 'solid' }, extra);
// A real straight line (lines are two-point paths), with the given settings
const line = (m, extra) => Object.assign(m.makeLine({ x: 0, y: 0 }, { x: 40, y: 10 }), { stroke: '#000000', sw: 2, dash: 'solid' }, extra);

test('line ends', async (t) => {
  await t.test('with no setting, ends are chosen as before: round for lines, flat for shapes', () => {
    const m = loadAppModules();
    assert.equal(m.strokeAttrs(outline())['stroke-linecap'], 'butt');
    assert.equal(m.strokeAttrs(line(m))['stroke-linecap'], 'round');
    assert.equal(m.strokeAttrs(line(m, { dash: 'dashed' }))['stroke-linecap'], 'butt');
  });

  await t.test('a chosen end is used as it is', () => {
    const m = loadAppModules();
    assert.equal(m.strokeAttrs(outline({ cap: 'square' }))['stroke-linecap'], 'square');
    assert.equal(m.strokeAttrs(line(m, { cap: 'butt' }))['stroke-linecap'], 'butt');
    assert.equal(m.strokeAttrs(outline({ cap: 'round', dash: 'dashed' }))['stroke-linecap'], 'round');
  });

  await t.test('dots stay visible: flat ends on a dotted outline become round', () => {
    const m = loadAppModules();
    assert.equal(m.strokeAttrs(outline({ dash: 'dotted', cap: 'butt' }))['stroke-linecap'], 'round');
    assert.equal(m.strokeAttrs(outline({ dash: 'dotted', cap: 'square' }))['stroke-linecap'], 'square');
  });

  await t.test('an unknown value falls back to automatic', () => {
    const m = loadAppModules();
    assert.equal(m.strokeAttrs(outline({ cap: 'pointy' }))['stroke-linecap'], 'butt');
  });
});

test('blend modes', async (t) => {
  await t.test('blendOf ignores normal and unknown modes', () => {
    const m = loadAppModules();
    assert.equal(m.blendOf({ blend: 'multiply' }), 'multiply');
    assert.equal(m.blendOf({ blend: 'normal' }), null);
    assert.equal(m.blendOf({ blend: 'url(evil)' }), null);
    assert.equal(m.blendOf({}), null);
    assert.equal(m.BLEND_IDS[0], 'normal');
    assert.equal(m.BLENDS.length, 16);
  });

  await t.test('a blended object is exported wrapped so fill, photo and outline blend together', () => {
    const m = loadAppModules();
    const o = m.newShape('rect', { fill: '#ff0000', stroke: '#000000', blend: 'screen' });
    const svg = m.objToSVG(o, 'p1', 'g1');
    assert.match(svg, /^<g style="mix-blend-mode:screen"><rect [^>]*\/><\/g>$/);
    delete o.blend;
    assert.doesNotMatch(m.objToSVG(o, 'p1', 'g1'), /mix-blend-mode/);
  });

  await t.test('a blended gradient shape keeps its gradient, and the blended group uses it', () => {
    const m = loadAppModules();
    const o = m.newShape('rect', { fill: '#ff0000', grad: m.makeGrad('linear'), blend: 'multiply' });
    const svg = m.objToSVG(o, 'p1', 'g1');
    assert.match(svg, /^<defs><linearGradient id="g1"[^]*<\/defs><g style="mix-blend-mode:multiply"><rect [^>]*fill="url\(#g1\)"/);
  });

  await t.test('combining keeps the bottom shape\'s blend mode and line ends', () => {
    const m = loadAppModules();
    const a = m.newShape('rect', { x: 0, y: 0, w: 50, h: 50, blend: 'multiply', cap: 'round' });
    const b = m.newShape('rect', { x: 25, y: 25, w: 50, h: 50 });
    const r = m.combineShapes('unite', [a, b]);
    assert.equal(r.blend, 'multiply');
    assert.equal(r.cap, 'round');
  });
});

test('SVG import: blend modes and line ends', async (t) => {
  await t.test('a shape keeps its blend mode and line ends; a group passes its blend mode to what is inside', () => {
    const m = loadAppModules();
    const paper = m._sandbox.paper;
    const a = new paper.Path({ segments: [[0, 0], [10, 10]], strokeColor: '#ff0000', strokeWidth: 2, strokeCap: 'square', insert: false });
    a.blendMode = 'difference';
    const inner = [0, 20].map((x) => new paper.Path.Rectangle({ point: [x, 0], size: [10, 10], fillColor: '#00ff00', insert: false }));
    const g = new paper.Group({ children: inner, insert: false }); g.blendMode = 'screen';
    const odd = new paper.Path.Rectangle({ point: [50, 0], size: [10, 10], fillColor: '#0000ff', insert: false }); odd.blendMode = 'add';
    const r = m.svgConvert(new paper.Group({ children: [a, g, odd], insert: false }));
    assert.equal(r.objects[0].blend, 'difference');
    assert.equal(r.objects[0].cap, 'square');
    assert.equal(r.objects[1].blend, 'screen');
    assert.equal(r.objects[2].blend, 'screen');
    assert.equal(r.objects[3].blend, undefined, 'paper.js-only modes that SVG and FriendShaped lack are dropped');
    assert.equal(r.objects[1].cap, undefined, 'shapes with no outline get no end setting');
  });
});
