'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');

const plain = (x) => JSON.parse(JSON.stringify(x));
const P = (m) => m._sandbox.paper;
// A root group standing in for the <svg> element, holding the given items
const rootOf = (m, items) => new (P(m).Group)({ children: items, insert: false });
const rect = (m, props) => new (P(m).Path.Rectangle)(Object.assign({ point: [0, 0], size: [10, 10], insert: false }, props));

test('svg import: shapes and groups', async (t) => {
  await t.test('each shape becomes an editable path, in page coordinates', () => {
    const m = loadAppModules();
    const r = m.svgConvert(rootOf(m, [rect(m, { point: [20, 30], size: [40, 10], fillColor: '#ff0000' })]));
    assert.equal(r.objects.length, 1);
    const o = r.objects[0];
    assert.equal(o.kind, 'path');
    assert.deepEqual([o.x, o.y, o.w, o.h], [20, 30, 40, 10]);
    assert.equal(o.fill, '#ff0000');
    assert.equal(o.stroke, 'none');
  });

  await t.test('the file itself is not a group, but groups inside it are, with their names', () => {
    const m = loadAppModules();
    const hills = new (P(m).Group)({ name: 'Hills', insert: false, children: [rect(m, { fillColor: '#00ff00' }), rect(m, { point: [20, 0], fillColor: '#00ff00' })] });
    const r = m.svgConvert(rootOf(m, [hills, rect(m, { fillColor: '#0000ff' })]));
    assert.equal(r.groups.length, 1);
    assert.equal(r.groups[0].name, 'Hills');
    assert.equal(r.objects.filter((o) => o.parent === r.groups[0].id).length, 2);
    assert.equal(r.objects[2].parent, undefined);
  });

  await t.test('a group holding a single thing adds nothing, so it is not kept', () => {
    const m = loadAppModules();
    const g = new (P(m).Group)({ insert: false, children: [rect(m, { fillColor: '#00ff00' })] });
    const r = m.svgConvert(rootOf(m, [g, rect(m, { fillColor: '#0000ff' })]));
    assert.equal(r.groups.length, 0);
  });

  await t.test('group transforms and opacity pass down to the shapes inside', () => {
    const m = loadAppModules();
    const g = new (P(m).Group)({ insert: false, opacity: 0.5, children: [rect(m, { fillColor: '#ff0000' }), rect(m, { point: [0, 20], fillColor: '#ff0000' })] });
    g.translate(new (P(m).Point)(100, 0)); g.scale(2, new (P(m).Point)(100, 0));
    const r = m.svgConvert(rootOf(m, [g]));
    assert.equal(r.objects[0].x, 100);
    assert.equal(r.objects[0].w, 20);
    assert.equal(r.objects[0].opacity, 0.5);
  });

  await t.test('outline widths grow with the shape\'s scale; see-through colors fold into opacity', () => {
    const m = loadAppModules();
    // an item that keeps its own transform (as text and pictures do after paper.js reads a file)
    const s = rect(m, { applyMatrix: false, fillColor: new (P(m).Color)(1, 0, 0, 0.4), strokeColor: '#000000', strokeWidth: 3, strokeJoin: 'round' });
    s.scale(2);
    const o = m.svgConvert(rootOf(m, [s])).objects[0];
    assert.equal(o.sw, 6);
    assert.equal(o.join, 'round');
    assert.equal(o.opacity, 0.4);
  });

  await t.test('invisible things and shapes with neither fill nor outline are left out', () => {
    const m = loadAppModules();
    const hidden = rect(m, { fillColor: '#ff0000' }); hidden.visible = false;
    const r = m.svgConvert(rootOf(m, [hidden, rect(m, {}), rect(m, { fillColor: '#00ff00' })]));
    assert.equal(r.objects.length, 1);
  });

  await t.test('a straight line keeps its outline but drops SVG\'s invisible default fill', () => {
    const m = loadAppModules();
    const line = new (P(m).Path)({ segments: [[0, 0], [30, 10]], fillColor: '#000000', strokeColor: '#ff0000', strokeWidth: 2, insert: false });
    const o = m.svgConvert(rootOf(m, [line])).objects[0];
    assert.equal(o.fill, 'none');
    assert.equal(o.stroke, '#ff0000');
    assert.equal(m.isOpenPath(o), true);
  });

  await t.test('dashes become dashed or dotted outlines', () => {
    const m = loadAppModules();
    const a = rect(m, { strokeColor: '#000000', strokeWidth: 2, dashArray: [6, 4] });
    const b = rect(m, { point: [20, 0], strokeColor: '#000000', strokeWidth: 4, dashArray: [1, 6] });
    const r = m.svgConvert(rootOf(m, [a, b]));
    assert.deepEqual(plain(r.objects.map((o) => o.dash)), ['dashed', 'dotted']);
  });
});

test('svg import: gradients', async (t) => {
  await t.test('a linear gradient is laid out over the shape\'s box', () => {
    const m = loadAppModules();
    const s = rect(m, { point: [100, 0], size: [200, 50], fillColor: { gradient: { stops: [['#ff0000', 0], ['#0000ff', 1]] }, origin: [100, 25], destination: [300, 25] } });
    const o = m.svgConvert(rootOf(m, [s])).objects[0];
    assert.equal(o.grad.type, 'linear');
    assert.deepEqual([o.grad.x1, o.grad.y1, o.grad.x2, o.grad.y2], [0, 0.5, 1, 0.5]);
    assert.deepEqual(plain(o.grad.stops.map((x) => x.c)), ['#ff0000', '#0000ff']);
    assert.equal(o.fill, '#ff0000');
  });

  await t.test('a radial gradient keeps its center, and see-through stops', () => {
    const m = loadAppModules();
    const C = P(m).Color;
    const s = rect(m, { size: [100, 100], fillColor: { gradient: { stops: [[new C(1, 1, 1, 1), 0], [new C(1, 1, 0, 0), 1]], radial: true }, origin: [50, 50], destination: [100, 50] } });
    const g = m.svgConvert(rootOf(m, [s])).objects[0].grad;
    assert.equal(g.type, 'radial');
    assert.deepEqual([g.cx, g.cy, g.r], [0.5, 0.5, 0.5]);
    assert.equal(g.stops[1].a, 0);
  });

  await t.test('a gradient with more colors than FriendShaped holds keeps its ends and evenly spaced colors', () => {
    const m = loadAppModules();
    const stops = Array.from({ length: 15 }, (_, i) => [i % 2 ? '#ffffff' : '#000000', i / 14]);
    const s = rect(m, { size: [100, 10], fillColor: { gradient: { stops }, origin: [0, 5], destination: [100, 5] } });
    const g = m.svgConvert(rootOf(m, [s])).objects[0].grad;
    assert.equal(g.stops.length, 8);
    assert.equal(g.stops[0].at, 0);
    assert.equal(g.stops[7].at, 1);
  });
});

test('svg import: holes, clipping, text and pictures', async (t) => {
  await t.test('an even-odd shape keeps its hole', () => {
    const m = loadAppModules();
    const paper = P(m);
    const ring = new paper.CompoundPath({ children: [new paper.Path.Circle({ center: [50, 50], radius: 40, insert: false }), new paper.Path.Circle({ center: [50, 50], radius: 20, insert: false })], fillColor: '#ff0000', fillRule: 'evenodd', insert: false });
    const o = m.svgConvert(rootOf(m, [ring])).objects[0];
    const check = new paper.CompoundPath({ pathData: o.d, insert: false });   // FriendShaped fills with the nonzero rule
    check.fillRule = 'nonzero';
    assert.equal(check.contains(new paper.Point(o.w / 2, o.h / 2)), false, 'the middle is a hole');
    assert.equal(check.contains(new paper.Point(5, o.h / 2)), true, 'the ring is filled');
  });

  await t.test('shapes are cut to their clip area; shapes already inside it are left alone', () => {
    const m = loadAppModules();
    const paper = P(m);
    const mask = rect(m, { point: [0, 0], size: [50, 50] }); mask.clipMask = true;
    const g = new paper.Group({ insert: false, children: [mask, rect(m, { point: [25, 25], size: [100, 100], fillColor: '#ff0000' }), rect(m, { point: [5, 5], size: [10, 10], fillColor: '#00ff00' })] });
    g.clipped = true;
    const r = m.svgConvert(rootOf(m, [g]));
    assert.deepEqual([r.objects[0].w, r.objects[0].h].map((v) => Math.round(v * 1e6) / 1e6), [25, 25]);
    assert.deepEqual([r.objects[1].w, r.objects[1].h], [10, 10]);
    assert.equal(r.counts.clipped, 1);
  });

  await t.test('text becomes FriendShaped text sitting on the SVG\'s baseline', () => {
    const m = loadAppModules();
    const txt = new (P(m).PointText)({ point: [50, 100], content: 'Hi', fontSize: 20, fillColor: '#123456', insert: false });
    const r = m.svgConvert(rootOf(m, [txt]));
    const o = r.objects[0];
    assert.equal(o.kind, 'text');
    assert.equal(o.text, 'Hi');
    assert.equal(o.size, 20);
    assert.equal(o.fill, '#123456');
    // test font: ascender 0.8, descender 0.2, line height 1.2, so the baseline is 18 below the top of the box
    assert.equal(o.x, 50);
    assert.equal(o.y, 82);
    assert.equal(r.counts.text, 1);
  });

  await t.test('a picture marker becomes a picture box, turned and flipped like the marker', () => {
    const m = loadAppModules();
    const paper = P(m);
    const mark = new paper.Path({ segments: [[0, 0], [40, 0], [40, 20], [0, 20]], closed: true, fillColor: '#000', name: m.SVG_IMG_MARK + '0', insert: false });
    mark.rotate(90, new paper.Point(0, 0));
    const r = m.svgConvert(rootOf(m, [mark]));
    assert.equal(r.objects.length, 0);
    assert.equal(r.pictures.length, 1);
    const b = m.svgPictureBox(r.pictures[0].corners);
    assert.ok(Math.abs(b.w - 40) < 1e-9 && Math.abs(b.h - 20) < 1e-9);
    assert.equal(b.rot, 90);
    assert.equal(b.flip, false);
    const flipped = m.svgPictureBox([{ x: 40, y: 0 }, { x: 0, y: 0 }, { x: 40, y: 20 }]);
    assert.equal(flipped.flip, true);
  });

  await t.test('a file with too many parts stops at the limit and says so', () => {
    const m = loadAppModules();
    const items = Array.from({ length: m.SVG_LIMITS.objects + 20 }, (_, i) => rect(m, { point: [i, 0], size: [1, 1], fillColor: '#000000' }));
    const r = m.svgConvert(rootOf(m, items));
    assert.equal(r.objects.length, m.SVG_LIMITS.objects);
    assert.equal(r.counts.tooMany, true);
  });
});
