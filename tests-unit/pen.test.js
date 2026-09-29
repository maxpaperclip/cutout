'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCutoutModules } = require('./harness');

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const pt = (x, y, hin = [0, 0], hout = [0, 0]) => ({ x, y, hin: { x: hin[0], y: hin[1] }, hout: { x: hout[0], y: hout[1] } });
const copy = (o) => JSON.parse(JSON.stringify(o));
// A path object from pen points, as the Pen tool makes it
function penShape(m, pts, closed, extra) {
  const g = m.penGeometry(pts, closed);
  return m.newShape('path', Object.assign({ x: g.x, y: g.y, w: g.w, h: g.h, nat: { d: g.d, w: g.w, h: g.h }, fill: closed ? '#ff0000' : 'none', stroke: '#000000' }, extra || {}));
}
// Where a box point of o lands on the page
const page = (m, o, x, y) => m.boxToWorld(o, x, y);

test('pen: drawing', async (t) => {
  await t.test('corner points make straight sides', () => {
    const m = loadCutoutModules();
    const g = m.penGeometry([pt(10, 10), pt(110, 10), pt(110, 60)], true);
    assert.deepEqual([g.x, g.y, g.w, g.h], [10, 10, 100, 50]);
    assert.match(g.d, /[Zz]$/);
    assert.doesNotMatch(g.d, /[Cc]/);
  });

  await t.test('a dragged point makes a curve, and an open line stays open', () => {
    const m = loadCutoutModules();
    const g = m.penGeometry([pt(0, 50), pt(50, 0, [-20, 0], [20, 0]), pt(100, 50)], false);
    assert.match(g.d, /[Cc]/);
    assert.doesNotMatch(g.d, /[Zz]/);
    assert.ok(near(g.y, 0, 1e-3));
  });

  await t.test('one point, or points on top of each other, make nothing', () => {
    const m = loadCutoutModules();
    assert.equal(m.penGeometry([pt(5, 5)], false), null);
    assert.equal(m.penGeometry([pt(5, 5), pt(5.1, 5.1)], false), null);
  });

  await t.test('Shift snaps to 45 degree steps', () => {
    const m = loadCutoutModules();
    const q = m.snap45({ x: 0, y: 0 }, { x: 100, y: 10 });
    assert.ok(near(q.y, 0) && near(q.x, Math.hypot(100, 10)));
    const r = m.snap45({ x: 0, y: 0 }, { x: 50, y: 60 });
    assert.ok(near(r.x, r.y));
  });
});

test('pen: page and box coordinates', async (t) => {
  await t.test('worldToBox undoes boxToWorld on a turned, mirrored object', () => {
    const m = loadCutoutModules();
    const o = { x: 40, y: 30, w: 120, h: 70, rot: 33, fx: true, fy: false };
    const [px, py] = m.boxToWorld(o, 17, 52);
    const [bx, by] = m.worldToBox(o, px, py);
    assert.ok(near(bx, 17) && near(by, 52));
  });
});

test('pen: editing points', async (t) => {
  await t.test('moving a point refits the box without moving the rest of the shape on the page', () => {
    const m = loadCutoutModules();
    const o = penShape(m, [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)], true, { rot: 30 });
    const keep = page(m, o, 100, 100);   // the bottom-right corner
    const o0 = copy(o), path = m.editablePath(o);
    m.segmentAt(path, '0:0').point = new (m._sandbox.paper.Point)(-50, -20);   // drag the top-left point outwards
    m.writePath(o, o0, path);
    assert.ok(near(o.w, 150) && near(o.h, 120));
    assert.equal(o.rot, 30);
    const after = m.editablePath(o).children[0].segments.map((s) => page(m, o, s.point.x, s.point.y));
    assert.ok(after.some((p) => near(p[0], keep[0], 1e-3) && near(p[1], keep[1], 1e-3)), 'the untouched corner stays put');
  });

  await t.test('a mirrored shape stays mirrored, and its photo stays put', () => {
    const m = loadCutoutModules();
    m.images.set('p', { id: 'p', w: 10, h: 10, dataUrl: 'data:,' });
    const o = penShape(m, [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)], true, { fx: true });
    o.pic = { id: 'p', dx: 5, dy: 0, s: 10 };
    const photo = page(m, o, o.w / 2 + o.pic.dx, o.h / 2 + o.pic.dy);
    const o0 = copy(o), path = m.editablePath(o);
    m.segmentAt(path, '0:1').point = new (m._sandbox.paper.Point)(160, 0);
    m.writePath(o, o0, path);
    assert.equal(o.fx, true);
    const photoAfter = page(m, o, o.w / 2 + o.pic.dx, o.h / 2 + o.pic.dy);
    assert.ok(near(photo[0], photoAfter[0], 1e-6) && near(photo[1], photoAfter[1], 1e-6));
  });

  await t.test('a gradient keeps its place on the page when the box grows', () => {
    const m = loadCutoutModules();
    const o = penShape(m, [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)], true, { grad: m.makeGrad('linear') });
    const endAt = (obj) => page(m, obj, obj.grad.x2 * obj.w, obj.grad.y2 * obj.h);
    const before = endAt(o);
    const o0 = copy(o), path = m.editablePath(o);
    m.segmentAt(path, '0:0').point = new (m._sandbox.paper.Point)(-100, 0);
    m.writePath(o, o0, path);
    const after = endAt(o);
    assert.ok(near(before[0], after[0], 1e-3) && near(before[1], after[1], 1e-3));
  });

  await t.test('points switch between sharp and smooth', () => {
    const m = loadCutoutModules();
    const path = m.editablePath(penShape(m, [pt(0, 0), pt(100, 0), pt(100, 100)], false));
    const s = m.segmentAt(path, '0:1');
    assert.equal(m.isSmoothPoint(s), false);
    m.setPointSmooth(s, true);
    assert.equal(m.isSmoothPoint(s), true);
    m.setPointSmooth(s, false);
    assert.equal(s.handleIn.length + s.handleOut.length, 0);
  });

  await t.test('dragging a handle on a smooth point turns the other one too, unless Alt is held', () => {
    const m = loadCutoutModules();
    const path = m.editablePath(penShape(m, [pt(0, 0), pt(100, 0, [-30, 0], [30, 0]), pt(200, 0)], false));
    const s = m.segmentAt(path, '0:1');
    m.moveHandle(s, 'out', { x: 0, y: 40 }, false);
    assert.ok(near(s.handleIn.x, 0, 1e-6) && near(s.handleIn.y, -30, 1e-6), 'turned to stay opposite, keeping its length');
    m.moveHandle(s, 'out', { x: 40, y: 0 }, true);
    assert.ok(near(s.handleIn.y, -30, 1e-6), 'Alt leaves the other handle alone');
  });

  await t.test('points can be removed, but a line keeps two and a closed shape keeps three', () => {
    const m = loadCutoutModules();
    const path = m.editablePath(penShape(m, [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)], true));
    assert.equal(m.removePoints(path, ['0:1']), true);
    assert.equal(path.children[0].segments.length, 3);
    assert.equal(m.removePoints(path, ['0:0']), false);
    const line = m.editablePath(penShape(m, [pt(0, 0), pt(100, 0), pt(50, 50)], false));
    assert.equal(m.removePoints(line, ['0:0', '0:2']), false);
    assert.equal(m.removePoints(line, ['0:2']), true);
  });

  await t.test('clicking the outline adds a point there without changing the shape', () => {
    const m = loadCutoutModules();
    const path = m.editablePath(penShape(m, [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)], true));
    const area = Math.abs(path.area);
    const key = m.insertPointNear(path, 50, 2);
    assert.equal(key, '0:1');
    const s = m.segmentAt(path, key);
    assert.ok(near(s.point.x, 50, 1e-6) && near(s.point.y, 0, 1e-6));
    assert.equal(path.children[0].segments.length, 5);
    assert.ok(near(Math.abs(path.area), area, 1e-6));
  });
});
