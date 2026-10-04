'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');

// Objects built inside the vm context have a different Object.prototype, so
// compare them as plain JSON rather than with deepEqual on the raw object.
const plain = (x) => JSON.parse(JSON.stringify(x));
const attr = (svg, name) => { const m = new RegExp(' ' + name + '="([^"]*)"').exec(svg); return m ? m[1] : null; };

test('gradients: model helpers', async (t) => {
  await t.test('makeGrad builds a two-stop linear gradient running left to right', () => {
    const m = loadAppModules();
    const g = m.makeGrad('linear', '#ff0000', '#0000ff');
    assert.deepEqual(plain(g), { type: 'linear', stops: [{ at: 0, c: '#ff0000', a: 1 }, { at: 1, c: '#0000ff', a: 1 }], x1: 0, y1: 0.5, x2: 1, y2: 0.5 });
  });

  await t.test('makeGrad builds a radial gradient that reaches the box edges', () => {
    const m = loadAppModules();
    const g = m.makeGrad('radial', '#ff0000', '#0000ff');
    assert.equal(g.type, 'radial');
    assert.deepEqual([g.cx, g.cy, g.r], [0.5, 0.5, 0.5]);
  });

  await t.test('makeGrad picks a partner color when only one is given', () => {
    const m = loadAppModules();
    const g = m.makeGrad('linear', '#ff0000');
    assert.equal(g.stops[0].c, '#ff0000');
    assert.equal(g.stops[1].c, '#ffff00');   // red turned 60 degrees is yellow
  });

  await t.test('shiftHue fades greys instead of turning them (they have no hue)', () => {
    const m = loadAppModules();
    assert.equal(m.shiftHue('#ffffff', 60), '#8c8c8c');
    assert.equal(m.shiftHue('#000000', 60), '#737373');
  });

  await t.test('hasGrad is false for photos even if they carry a grad', () => {
    const m = loadAppModules();
    const g = m.makeGrad('linear');
    assert.equal(m.hasGrad({ kind: 'rect', grad: g }), true);
    assert.equal(m.hasGrad({ kind: 'text', grad: g }), true);
    assert.equal(m.hasGrad({ kind: 'image', grad: g }), false);
    assert.equal(m.hasGrad({ kind: 'rect' }), false);
  });

  await t.test('setGradAngle(0) spans the full width, and gradAngle reads it back', () => {
    const m = loadAppModules();
    const o = { kind: 'rect', x: 0, y: 0, w: 200, h: 50, grad: m.makeGrad('linear') };
    m.setGradAngle(o, 0);
    assert.deepEqual([o.grad.x1, o.grad.y1, o.grad.x2, o.grad.y2], [0, 0.5, 1, 0.5]);
    assert.equal(m.gradAngle(o), 0);
  });

  await t.test('setGradAngle measures angles on the page, even on a wide box', () => {
    const m = loadAppModules();
    const o = { kind: 'rect', x: 0, y: 0, w: 300, h: 60, grad: m.makeGrad('linear') };
    for (const deg of [45, 90, -30, 135, 180]) {
      m.setGradAngle(o, deg);
      assert.ok(Math.abs(m.gradAngle(o) - deg) < 1e-3, 'angle ' + deg + ' came back as ' + m.gradAngle(o));
    }
  });

  await t.test('setGradAngle(45) reaches exactly into the corners', () => {
    const m = loadAppModules();
    const o = { kind: 'rect', x: 0, y: 0, w: 100, h: 100, grad: m.makeGrad('linear') };
    m.setGradAngle(o, 45);
    assert.deepEqual([o.grad.x1, o.grad.y1, o.grad.x2, o.grad.y2], [0, 0, 1, 1]);
  });

  await t.test('reverseGrad swaps colors end for end and mirrors stop positions', () => {
    const m = loadAppModules();
    const g = m.makeGrad('linear', '#ff0000', '#0000ff');
    g.stops.splice(1, 0, { at: 0.2, c: '#00ff00', a: 0.5 });
    m.reverseGrad(g);
    assert.deepEqual(plain(g.stops), [{ at: 0, c: '#0000ff', a: 1 }, { at: 0.8, c: '#00ff00', a: 0.5 }, { at: 1, c: '#ff0000', a: 1 }]);
  });

  await t.test('syncGradFill keeps the plain fill equal to the first color (for older versions)', () => {
    const m = loadAppModules();
    const o = { kind: 'rect', fill: '#123456', grad: m.makeGrad('linear', '#ff0000', '#0000ff') };
    m.syncGradFill(o);
    assert.equal(o.fill, '#ff0000');
  });
});

test('gradients: sanitizeGrad (opening files)', async (t) => {
  await t.test('keeps a valid gradient', () => {
    const m = loadAppModules();
    const g = m.makeGrad('radial', '#ff0000', '#0000ff');
    assert.deepEqual(plain(m.sanitizeGrad(plain(g))), plain(g));
  });

  await t.test('rejects unknown types, missing stops and junk', () => {
    const m = loadAppModules();
    assert.equal(m.sanitizeGrad(null), null);
    assert.equal(m.sanitizeGrad('linear'), null);
    assert.equal(m.sanitizeGrad({ type: 'conic', stops: [{ at: 0, c: '#000' }, { at: 1, c: '#fff' }] }), null);
    assert.equal(m.sanitizeGrad({ type: 'linear' }), null);
    assert.equal(m.sanitizeGrad({ type: 'linear', stops: [{ at: 0, c: '#000000' }] }), null);
  });

  await t.test('drops stops with bad colors, and gives up if fewer than two remain', () => {
    const m = loadAppModules();
    const g = m.sanitizeGrad({ type: 'linear', stops: [{ at: 0, c: 'red' }, { at: 0.5, c: '#abc' }, { at: 1, c: 'url(evil)' }] });
    assert.equal(g, null);
    const ok = m.sanitizeGrad({ type: 'linear', stops: [{ at: 0, c: 'red' }, { at: 0.5, c: '#ABC' }, { at: 1, c: '#000000' }] });
    assert.deepEqual(plain(ok.stops), [{ at: 0.5, c: '#aabbcc', a: 1 }, { at: 1, c: '#000000', a: 1 }]);
  });

  await t.test('clamps numbers, sorts stops and caps how many there are', () => {
    const m = loadAppModules();
    const stops = [];
    for (let i = 0; i < 20; i++) stops.push({ at: 1 - i / 19, c: '#000000', a: 5 });
    const g = m.sanitizeGrad({ type: 'linear', stops, x1: 'x', y1: -1e9, x2: 1e9, y2: NaN });
    assert.equal(g.stops.length, 8);
    assert.ok(g.stops.every((s, i) => s.a === 1 && (i === 0 || s.at >= g.stops[i - 1].at)));
    assert.deepEqual([g.x1, g.y1, g.x2, g.y2], [0, -1000, 1000, 0.5]);
  });

  await t.test('keeps a focal point only when both coordinates are present', () => {
    const m = loadAppModules();
    const base = { type: 'radial', stops: [{ at: 0, c: '#ffffff' }, { at: 1, c: '#000000' }], cx: 0.5, cy: 0.5, r: 0.5 };
    assert.equal(m.sanitizeGrad(Object.assign({ fx: 0.3 }, base)).fx, undefined);
    const g = m.sanitizeGrad(Object.assign({ fx: 0.3, fy: 0.3 }, base));
    assert.deepEqual([g.fx, g.fy], [0.3, 0.3]);
  });
});

test('gradients: SVG output', async (t) => {
  await t.test('styleAttrs uses the gradient only when given an id to point at', () => {
    const m = loadAppModules();
    const o = { kind: 'rect', fill: '#ff0000', stroke: 'none', opacity: 1, grad: m.makeGrad('linear') };
    assert.equal(m.styleAttrs(o).fill, '#ff0000');
    assert.equal(m.styleAttrs(o, 'g7').fill, 'url(#g7)');
  });

  await t.test('a rectangle, like every object, gets its gradient in its own box, placed on the page by translate', () => {
    const m = loadAppModules();
    const o = m.newShape('rect', { x: 100, y: 50, w: 200, h: 80, fill: '#ff0000', grad: m.makeGrad('linear', '#ff0000', '#0000ff') });
    const svg = m.objToSVG(o, 'pc1', 'gr1');
    assert.match(svg, /^<defs><linearGradient id="gr1" gradientUnits="userSpaceOnUse"/);
    assert.deepEqual(['x1', 'y1', 'x2', 'y2'].map((k) => attr(svg, k)), ['0', '40', '200', '40']);
    assert.match(svg, /<rect [^>]*transform="translate\(100 50\)"/);
    assert.match(svg, /<stop offset="0" stop-color="#ff0000"\/><stop offset="1" stop-color="#0000ff"\/>/);
    assert.match(svg, /<rect [^>]*fill="url\(#gr1\)"/);
  });

  await t.test('a polygon (drawn in box coordinates) gets its gradient in box coordinates', () => {
    const m = loadAppModules();
    const o = m.newShape('polygon', { x: 100, y: 50, w: 200, h: 80, fill: '#ff0000', grad: m.makeGrad('linear') });
    const svg = m.objToSVG(o, 'pc1', 'gr1');
    assert.deepEqual(['x1', 'y1', 'x2', 'y2'].map((k) => attr(svg, k)), ['0', '40', '200', '40']);
  });

  await t.test('a radial gradient is a unit circle scaled to the box', () => {
    const m = loadAppModules();
    const o = m.newShape('ellipse', { x: 10, y: 20, w: 200, h: 100, fill: '#ff0000', grad: m.makeGrad('radial') });
    const svg = m.objToSVG(o, 'pc1', 'gr1');
    assert.match(svg, /<radialGradient id="gr1" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate\(100 50\) scale\(100 50\)">/);
    assert.match(svg, /<ellipse [^>]*transform="translate\(10 20\)"/);
    assert.equal(attr(svg, 'fx'), null);
  });

  await t.test('a radial focal point is written relative to the unit circle', () => {
    const m = loadAppModules();
    const g = m.makeGrad('radial'); g.fx = 0.25; g.fy = 0.5;
    const o = m.newShape('rect', { x: 0, y: 0, w: 100, h: 100, fill: '#ff0000', grad: g });
    const svg = m.objToSVG(o, 'pc1', 'gr1');
    assert.deepEqual([attr(svg, 'fx'), attr(svg, 'fy')], ['-0.5', '0']);
  });

  await t.test('stop opacity is written only when a color is see-through', () => {
    const m = loadAppModules();
    const g = m.makeGrad('linear'); g.stops[1].a = 0;
    const o = m.newShape('rect', { fill: '#ff0000', grad: g });
    const svg = m.objToSVG(o, 'pc1', 'gr1');
    assert.equal((svg.match(/stop-opacity/g) || []).length, 1);
    assert.match(svg, /stop-opacity="0"/);
  });

  await t.test('flipping or turning a shape changes its transform, not its gradient', () => {
    const m = loadAppModules();
    const g = m.makeGrad('linear');
    const a = m.newShape('polygon', { x: 0, y: 0, w: 100, h: 60, fill: '#ff0000', grad: m.cloneGrad(g) });
    const b = m.newShape('polygon', { x: 0, y: 0, w: 100, h: 60, fill: '#ff0000', grad: m.cloneGrad(g), fx: true, rot: 30 });
    const defOf = (svg) => svg.slice(0, svg.indexOf('</defs>'));
    const sa = m.objToSVG(a, 'p', 'g'), sb = m.objToSVG(b, 'p', 'g');
    assert.equal(defOf(sa), defOf(sb));
    assert.notEqual(attr(sa.slice(sa.indexOf('<path')), 'transform'), attr(sb.slice(sb.indexOf('<path')), 'transform'));
  });

  await t.test('resizing a shape stretches its gradient along with it', () => {
    const m = loadAppModules();
    const o = m.newShape('rect', { x: 0, y: 0, w: 100, h: 100, fill: '#ff0000', grad: m.makeGrad('linear') });
    assert.equal(attr(m.objToSVG(o, 'p', 'g'), 'x2'), '100');
    o.w = 250; m.refresh(o);
    assert.equal(attr(m.objToSVG(o, 'p', 'g'), 'x2'), '250');
  });

  await t.test('a new line never picks up the remembered gradient', () => {
    const m = loadAppModules();
    m.S.style.grad = m.makeGrad('linear');
    const o = m.makeLine({ x: 0, y: 0 }, { x: 10, y: 10 });
    assert.equal(o.grad, undefined);
    assert.doesNotMatch(m.objToSVG(o, 'p', 'g'), /Gradient/);
  });

  await t.test('buildSVG gives each gradient its own id', () => {
    const m = loadAppModules();
    const a = m.newShape('rect', { fill: '#ff0000', grad: m.makeGrad('linear') });
    const b = m.newShape('ellipse', { fill: '#ff0000', grad: m.makeGrad('radial') });
    const c = m.newShape('rect', { fill: '#00ff00' });
    const svg = m.buildSVG([a, c, b], { x: 0, y: 0, w: 800, h: 600 }, 800, 600, null);
    assert.match(svg, /<linearGradient id="gr1"/);
    assert.match(svg, /<radialGradient id="gr3"/);
    assert.match(svg, /fill="url\(#gr1\)"/);
    assert.match(svg, /fill="url\(#gr3\)"/);
    assert.equal((svg.match(/Gradient id=/g) || []).length, 2);
  });

  await t.test('a photo fill that does not cover the shape shows the gradient around it', () => {
    const m = loadAppModules();
    m.images.set('p1', { id: 'p1', w: 10, h: 10, dataUrl: 'data:image/png;base64,AA==' });
    const o = m.newShape('rect', { x: 0, y: 0, w: 100, h: 100, fill: '#ff0000', grad: m.makeGrad('linear') });
    o.pic = { id: 'p1', dx: 0, dy: 0, s: 1 };   // a 10x10 photo inside a 100x100 shape
    const svg = m.objToSVG(o, 'pc1', 'gr1');
    assert.match(svg, /<linearGradient id="gr1"/);
    assert.match(svg, /<rect [^>]*fill="url\(#gr1\)"/);
    assert.match(svg, /<clipPath id="pc1">/);
  });
});

test('gradients: document behavior', async (t) => {
  await t.test('new shapes copy the remembered gradient, each getting its own copy', () => {
    const m = loadAppModules();
    m.S.style.grad = m.makeGrad('radial', '#ff0000', '#0000ff');
    const a = m.newShape('rect', {}), b = m.newShape('polygon', {});
    assert.equal(a.grad.type, 'radial');
    assert.equal(a.fill, '#ff0000');
    assert.notEqual(a.grad, b.grad);
    assert.notEqual(a.grad, m.S.style.grad);
    a.grad.stops[0].c = '#00ff00';
    assert.equal(b.grad.stops[0].c, '#ff0000');
  });

  await t.test('text, lines, and shapes given an explicit fill do not pick up the remembered gradient', () => {
    const m = loadAppModules();
    m.S.style.grad = m.makeGrad('linear');
    assert.equal(m.newShape('text', {}).grad, undefined);
    assert.equal(m.makeLine({ x: 0, y: 0 }, { x: 5, y: 5 }).grad, undefined);
    assert.equal(m.newShape('rect', { fill: '#00ff00' }).grad, undefined);
  });

  await t.test('combining shapes keeps the bottom shape\'s gradient, as a separate copy', () => {
    const m = loadAppModules();
    const a = m.newShape('rect', { x: 0, y: 0, w: 100, h: 100, fill: '#ff0000', grad: m.makeGrad('radial', '#ff0000', '#0000ff') });
    const b = m.newShape('rect', { x: 50, y: 50, w: 100, h: 100, fill: '#00ff00' });
    const res = m.combineShapes('unite', [a, b]);
    assert.equal(res.grad.type, 'radial');
    assert.deepEqual(plain(res.grad), plain(a.grad));
    assert.notEqual(res.grad, a.grad);
  });

  await t.test('combining a solid bottom shape does not add a gradient', () => {
    const m = loadAppModules();
    m.S.style.grad = m.makeGrad('linear');   // even with a remembered gradient
    const a = m.newShape('rect', { x: 0, y: 0, w: 100, h: 100, fill: '#ff0000' });
    const b = m.newShape('rect', { x: 50, y: 50, w: 100, h: 100, fill: '#00ff00', grad: m.makeGrad('linear') });
    assert.equal(m.combineShapes('unite', [a, b]).grad, undefined);
  });

  await t.test('flattening a rectangle keeps its gradient in the same place on the page', () => {
    const m = loadAppModules();
    const o = m.newShape('rect', { x: 100, y: 50, w: 200, h: 80, fill: '#ff0000', grad: m.makeGrad('linear') });
    m.doc.objects.push(o); m.S.sel = new Set([o.id]);
    const before = m.objToSVG(o, 'p', 'g');
    m.flattenSelected();
    const after = m.objToSVG(o, 'p', 'g');
    assert.equal(o.kind, 'path');
    // both are drawn in box coordinates inside translate(100 50), so the gradient doesn't change at all
    assert.equal(before.slice(0, before.indexOf('</defs>')), after.slice(0, after.indexOf('</defs>')));
    assert.deepEqual(['x1', 'x2'].map((k) => +attr(after, k)), [0, 200]);
    assert.match(before, /transform="translate\(100 50\)"/);
    assert.match(after, /transform="translate\(100 50\)"/);
  });
});

test('gradients: editing colors along the gradient', async (t) => {
  const three = (m) => { const g = m.makeGrad('linear', '#000000', '#ffffff'); g.stops.splice(1, 0, { at: 0.5, c: '#ff0000', a: 1 }); return g; };

  await t.test('gradColorAt blends between the stops on either side', () => {
    const m = loadAppModules();
    const g = m.makeGrad('linear', '#000000', '#ffffff');
    assert.deepEqual(plain(m.gradColorAt(g.stops, 0.5)), { c: '#808080', a: 1 });
    assert.deepEqual(plain(m.gradColorAt(g.stops, 0)), { c: '#000000', a: 1 });
    assert.deepEqual(plain(m.gradColorAt(g.stops, 1)), { c: '#ffffff', a: 1 });
  });

  await t.test('gradColorAt blends opacity too, and holds the end colors past the ends', () => {
    const m = loadAppModules();
    const g = m.makeGrad('linear', '#ff0000', '#ff0000');
    g.stops[0].at = 0.2; g.stops[1].at = 0.6; g.stops[1].a = 0;
    assert.equal(m.gradColorAt(g.stops, 0.4).a, 0.5);
    assert.equal(m.gradColorAt(g.stops, 0.1).a, 1);
    assert.equal(m.gradColorAt(g.stops, 0.9).a, 0);
  });

  await t.test('addGradStop inserts in order, matching the color already shown there', () => {
    const m = loadAppModules();
    const g = m.makeGrad('linear', '#000000', '#ffffff');
    const i = m.addGradStop(g, 0.25);
    assert.equal(i, 1);
    assert.deepEqual(plain(g.stops[1]), { at: 0.25, c: '#404040', a: 1 });
  });

  await t.test('addGradStop clamps the position and stops at the maximum', () => {
    const m = loadAppModules();
    const g = m.makeGrad('linear', '#000000', '#ffffff');
    assert.equal(g.stops[m.addGradStop(g, 1.7)].at, 1);
    while (g.stops.length < m.GRAD_MAX_STOPS) m.addGradStop(g, 0.5);
    assert.equal(m.addGradStop(g, 0.5), -1);
    assert.equal(g.stops.length, m.GRAD_MAX_STOPS);
  });

  await t.test('removeGradStop keeps at least two colors and says what to select next', () => {
    const m = loadAppModules();
    const g = three(m);
    assert.equal(m.removeGradStop(g, 2), 1);   // removing the last selects the new last
    assert.deepEqual(plain(g.stops.map((s) => s.c)), ['#000000', '#ff0000']);
    assert.equal(m.removeGradStop(g, 0), -1);
    assert.equal(g.stops.length, 2);
    assert.equal(m.removeGradStop(three(m), 7), -1);
  });

  await t.test('moveGradStop lets a color pass its neighbours and reports where it ended up', () => {
    const m = loadAppModules();
    const g = three(m);
    const i = m.moveGradStop(g, 0, 0.75);   // black slides past red
    assert.equal(i, 1);
    assert.deepEqual(plain(g.stops.map((s) => [s.at, s.c])), [[0.5, '#ff0000'], [0.75, '#000000'], [1, '#ffffff']]);
    assert.equal(m.moveGradStop(g, 0, -3), 0);
    assert.equal(g.stops[0].at, 0);
    assert.equal(m.moveGradStop(g, 9, 0.5), -1);
  });

  await t.test('many colors and see-through colors export in order', () => {
    const m = loadAppModules();
    const g = m.makeGrad('linear', '#000000', '#ffffff');
    g.stops[m.addGradStop(g, 0.7)].c = '#00ff00';
    g.stops[m.addGradStop(g, 0.3)].a = 0.25;   // blends black toward the green at 0.7
    const o = m.newShape('rect', { fill: '#000000', grad: g });
    const svg = m.objToSVG(o, 'p', 'gr1');
    const offsets = [...svg.matchAll(/<stop offset="([^"]+)"/g)].map((x) => +x[1]);
    assert.deepEqual(offsets, [0, 0.3, 0.7, 1]);
    assert.match(svg, /<stop offset="0.3" stop-color="#006d00" stop-opacity="0.25"\/>/);
  });

  await t.test('a saved gradient with many see-through colors opens unchanged', () => {
    const m = loadAppModules();
    const g = three(m); g.stops[1].a = 0; g.stops[2].a = 0.4;
    assert.deepEqual(plain(m.sanitizeGrad(plain(g))), plain(g));
  });
});
