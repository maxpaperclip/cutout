'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');

test('document model: newShape', async (t) => {
  await t.test('assigns increasing ids across a session', () => {
    const m = loadAppModules();
    const a = m.newShape('rect', {});
    const b = m.newShape('rect', {});
    assert.equal(b.id, a.id + 1);
  });

  await t.test('rect defaults to r (corner radius) of 0', () => {
    const m = loadAppModules();
    const r = m.newShape('rect', {});
    assert.equal(r.r, 0);
  });

  await t.test('polygon defaults to a hexagon that is not a star', () => {
    const m = loadAppModules();
    const p = m.newShape('polygon', {});
    assert.equal(p.sides, 6);
    assert.equal(p.star, false);
    assert.equal(p.inner, 0.45);
    assert.ok(p.d.startsWith('M'), 'polygon should get a generated path');
  });

  await t.test('a line is a plain two-point shape with no fill and a visible stroke', () => {
    const m = loadAppModules();
    const l = m.makeLine({ x: 0, y: 0 }, { x: 50, y: 50 });
    assert.equal(l.kind, 'path');
    assert.equal(l.fill, 'none');
    assert.notEqual(l.stroke, 'none');
    assert.ok(l.sw >= 3, 'line stroke width should have a sensible minimum');
    assert.equal(m.isStraightLine(l), true);
    assert.equal(m.labelOf(l), 'Line');
  });

  await t.test('line box (x/y/w/h) is derived from its endpoints, and lineEnds gives them back', () => {
    const m = loadAppModules();
    const l = m.makeLine({ x: 30, y: 100 }, { x: 130, y: 40 });
    assert.equal(l.x, 30);
    assert.equal(l.y, 40);
    assert.equal(l.w, 100);
    assert.equal(l.h, 60);
    assert.deepEqual(JSON.parse(JSON.stringify(m.lineEnds(l))), [[30, 100], [130, 40]]);
  });

  await t.test('a perfectly flat line still has a usable box', () => {
    const m = loadAppModules();
    const l = m.makeLine({ x: 0, y: 20 }, { x: 80, y: 20 });
    assert.ok(l.h > 0 && l.h < 0.1);
    assert.deepEqual(JSON.parse(JSON.stringify(m.lineEnds(l))), [[0, 20], [80, 20]]);
  });

  await t.test('text gets sensible defaults', () => {
    const m = loadAppModules();
    const txt = m.newShape('text', {});
    assert.equal(txt.text, ' ');   // a new text is one space: typed over, and dropped if nothing is typed
    assert.equal(txt.align, 'left');
    assert.equal(txt.lh, 1.2);
    assert.equal(txt.fill, '#151936');
  });

  await t.test('explicit props override the kind-specific defaults', () => {
    const m = loadAppModules();
    const txt = m.newShape('text', { text: 'Hi', fill: '#ff0000' });
    assert.equal(txt.text, 'Hi');
    assert.equal(txt.fill, '#ff0000');
  });
});

test('document model: buildPolygon', async (t) => {
  await t.test('a plain polygon path starts at M and closes with Z', () => {
    const m = loadAppModules();
    const shape = { sides: 5, star: false, inner: 0.45, w: 100, h: 100 };
    const d = m.buildPolygon(shape);
    assert.ok(d.startsWith('M'));
    assert.ok(d.endsWith('Z'));
  });

  await t.test('a star has twice as many vertices as a plain polygon with the same sides', () => {
    const m = loadAppModules();
    const plain = m.buildPolygon({ sides: 5, star: false, inner: 0.45, w: 100, h: 100 });
    const star = m.buildPolygon({ sides: 5, star: true, inner: 0.45, w: 100, h: 100 });
    const countPoints = (d) => d.split('L').length; // one point per "L" plus the initial "M"
    // star alternates outer/inner points, so it has 2x the vertices (outer + inner)
    assert.equal(countPoints(star), countPoints(plain) * 2);
  });

  await t.test('sides are clamped to the 3..24 range', () => {
    const m = loadAppModules();
    const tooFew = m.buildPolygon({ sides: 1, star: false, inner: 0.45, w: 100, h: 100 });
    const tooMany = m.buildPolygon({ sides: 99, star: false, inner: 0.45, w: 100, h: 100 });
    // 3 sides -> 2 "L" segments + implicit first point; 24 sides -> 23 "L"s
    assert.equal(tooFew.split('L').length, 3);
    assert.equal(tooMany.split('L').length, 24);
  });
});

test('document model: bounds (aabb / unionBox / centerOf)', async (t) => {
  await t.test('aabb of an unrotated shape is just its box', () => {
    const m = loadAppModules();
    const o = { x: 10, y: 20, w: 100, h: 50, rot: 0 };
    const b = m.aabb(o);
    // NB: b was created inside the vm sandbox, so it's not the same "realm"
    // as the plain object literal below - deepStrictEqual would (correctly)
    // treat them as different types even with identical own properties.
    // Comparing fields individually sidesteps that and is what we actually
    // care about here.
    assert.equal(b.x, 10);
    assert.equal(b.y, 20);
    assert.equal(b.w, 100);
    assert.equal(b.h, 50);
  });

  await t.test('aabb of a 90-degree-rotated non-square box swaps width/height', () => {
    const m = loadAppModules();
    const o = { x: 0, y: 0, w: 100, h: 40, rot: 90 };
    const b = m.aabb(o);
    assert.ok(Math.abs(b.w - 40) < 1e-6);
    assert.ok(Math.abs(b.h - 100) < 1e-6);
  });

  await t.test('centerOf returns the midpoint of the box', () => {
    const m = loadAppModules();
    const c = m.centerOf({ x: 0, y: 0, w: 100, h: 50 });
    assert.equal(c.x, 50);
    assert.equal(c.y, 25);
  });

  await t.test('unionBox covers every shape in the list', () => {
    const m = loadAppModules();
    const list = [
      { x: 0, y: 0, w: 10, h: 10, rot: 0 },
      { x: 100, y: 50, w: 20, h: 20, rot: 0 },
    ];
    const box = m.unionBox(list);
    assert.equal(box.x, 0);
    assert.equal(box.y, 0);
    assert.equal(box.w, 120);
    assert.equal(box.h, 70);
  });

  await t.test('moveBy shifts a shape box by dx/dy', () => {
    const m = loadAppModules();
    const o = { x: 10, y: 10, w: 5, h: 5, kind: 'rect' };
    m.moveBy(o, 5, -3);
    assert.equal(o.x, 15);
    assert.equal(o.y, 7);
  });

  await t.test('moveBy also shifts a line\'s endpoints', () => {
    const m = loadAppModules();
    const l = m.makeLine({ x: 0, y: 0 }, { x: 10, y: 10 });
    m.moveBy(l, 5, 5);
    assert.deepEqual(JSON.parse(JSON.stringify(m.lineEnds(l))), [[5, 5], [15, 15]]);
  });
});

test('document model: labelOf / iconFor', async (t) => {
  await t.test('a named object uses its name regardless of kind', () => {
    const m = loadAppModules();
    assert.equal(m.labelOf({ kind: 'rect', name: 'My Box' }), 'My Box');
  });

  await t.test('an unnamed rect falls back to "Rectangle"', () => {
    const m = loadAppModules();
    assert.equal(m.labelOf({ kind: 'rect', name: '' }), 'Rectangle');
  });

  await t.test('a star polygon is labeled "Star", not "Polygon"', () => {
    const m = loadAppModules();
    assert.equal(m.labelOf({ kind: 'polygon', star: true, name: '' }), 'Star');
    assert.equal(m.labelOf({ kind: 'polygon', star: false, name: '' }), 'Polygon');
  });

  await t.test('unnamed text uses its first line, truncated to 26 chars', () => {
    const m = loadAppModules();
    const longText = 'This is a very long first line that should be truncated';
    const label = m.labelOf({ kind: 'text', name: '', text: longText + '\nsecond line' });
    assert.equal(label, longText.slice(0, 26));
  });

  await t.test('a text that is only spaces is called "Text" rather than shown with a blank name', () => {
    const m = loadAppModules();
    assert.equal(m.labelOf({ kind: 'text', name: '', text: ' ' }), 'Text');
    assert.equal(m.labelOf({ kind: 'text', name: '', text: '   \nsecond line' }), 'Text');
    assert.equal(m.labelOf({ kind: 'text', name: '', text: ' hi' }), ' hi');
  });

  await t.test('iconFor a star polygon is "star", a plain polygon is "polygon"', () => {
    const m = loadAppModules();
    assert.equal(m.iconFor({ kind: 'polygon', star: true }), 'star');
    assert.equal(m.iconFor({ kind: 'polygon', star: false }), 'polygon');
  });

  await t.test('iconFor a shape with a photo fill is "image"', () => {
    const m = loadAppModules();
    m.images.set('pic1', { id: 'pic1', w: 10, h: 10 });
    const shapeWithPhoto = { kind: 'rect', pic: { id: 'pic1' } };
    assert.equal(m.iconFor(shapeWithPhoto), 'image');
  });
});
