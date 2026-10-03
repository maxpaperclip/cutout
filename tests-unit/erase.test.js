'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCutoutModules } = require('./harness');

const PIC = 'data:image/png;base64,AA==';
const MASK = 'data:image/png;base64,BB==';
// A 200 x 100 photo at (50, 40) with the usual fields, plus its picture (and optionally a mask picture)
function withPhoto(m, props) {
  m.images.set('p1', { id: 'p1', w: 400, h: 200, dataUrl: PIC });
  m.images.set('m1', { id: 'm1', w: 400, h: 200, dataUrl: MASK, mask: true });
  const o = m.makeImage(m.images.get('p1'), Object.assign({ x: 50, y: 40, w: 200, h: 100 }, props));
  m.doc.objects.push(o);
  return o;
}
const tags = (n, out = []) => { out.push(n.tag); (n.kids || []).forEach(k => tags(k, out)); return out; };
const stroke = (extra) => Object.assign({ d: 'M10 10L10 10L30 20', size: 20, soft: 0, restore: false, open: false }, extra);

test('erase: what counts as a photo', async (t) => {
  await t.test('docImageIds includes the erase mask, docPhotoIds does not', () => {
    const m = loadCutoutModules();
    const o = withPhoto(m, { erase: 'm1' });
    assert.deepEqual([...m.docImageIds(m.doc)].sort(), ['m1', 'p1']);
    assert.deepEqual([...m.docPhotoIds(m.doc)], ['p1']);
    assert.equal(o.erase, 'm1');
  });

  await t.test('only photos can be erased for now', () => {
    const m = loadCutoutModules();
    const o = withPhoto(m);
    assert.equal(m.canErase(o), true);
    assert.equal(m.canErase(m.newShape('rect', {})), false);
    assert.equal(m.canErase(null), false);
  });
});

test('erase: describing the mask', async (t) => {
  await t.test('nothing erased means no mask at all', () => {
    const m = loadCutoutModules();
    const o = withPhoto(m);
    assert.equal(m.eraseView(o, 'em1'), null);
    const v = m.objView(o, { grad: 'g', clip: 'c', mask: 'em1' });
    assert.equal(v.node.a.mask, undefined);
    assert.equal(v.defs.length, 0);
  });

  await t.test('an erased photo is drawn through a mask: white backdrop, then the mask picture in the photo box', () => {
    const m = loadCutoutModules();
    const o = withPhoto(m, { erase: 'm1' });
    const v = m.objView(o, { grad: 'g', clip: 'c', mask: 'em1' });
    assert.equal(v.node.a.mask, 'url(#em1)');
    const mask = v.defs.find(d => d.tag === 'mask');
    assert.equal(mask.a.id, 'em1');
    assert.equal(mask.a.maskUnits, 'userSpaceOnUse');
    assert.equal(mask.kids[0].tag, 'rect');
    assert.equal(mask.kids[0].a.fill, '#fff');
    const img = mask.kids[1];
    assert.equal(img.tag, 'image');
    assert.equal(img.a.href, MASK);
    assert.equal(img.a.width, 200); assert.equal(img.a.height, 100);
    assert.equal(img.a.transform, m.objXf(o));   // the same placement as the photo itself, so rotation and flips carry over
    assert.equal(img.a.preserveAspectRatio, 'none');
  });

  await t.test('the backdrop covers the turned photo and leaves room for an outline', () => {
    const m = loadCutoutModules();
    const o = withPhoto(m, { erase: 'm1', rot: 30 });
    const box = m.aabb(o), rect = m.objView(o, { mask: 'em1' }).defs.find(d => d.tag === 'mask').kids[0].a;
    assert.ok(rect.x < box.x && rect.y < box.y);
    assert.ok(rect.x + rect.width > box.x + box.w && rect.y + rect.height > box.y + box.h);
  });

  await t.test('a mask picture that has gone missing is ignored, so the photo still shows', () => {
    const m = loadCutoutModules();
    const o = withPhoto(m, { erase: 'gone' });
    assert.equal(m.eraseView(o, 'em1'), null);
  });

  await t.test('a stroke being drawn is inside the mask: black erases, white restores', () => {
    const m = loadCutoutModules();
    const o = withPhoto(m, { erase: 'm1' });
    m.eraseLive.set(o.id, [stroke(), stroke({ restore: true })]);
    const mask = m.objView(o, { mask: 'em1' }).defs.find(d => d.tag === 'mask');
    const paths = mask.kids.filter(k => k.tag === 'path');
    assert.equal(paths.length, 2);
    assert.equal(paths[0].a.stroke, '#000'); assert.equal(paths[1].a.stroke, '#fff');
    assert.equal(paths[0].a['stroke-width'], 20);
    assert.equal(paths[0].a['stroke-linecap'], 'round');
    assert.equal(paths[0].a.transform, m.objXf(o));
    // the strokes come after the saved picture, so they paint over it
    assert.deepEqual(Array.from(mask.kids, k => k.tag), ['rect', 'image', 'path', 'path']);
  });

  await t.test('a stroke alone is enough to make a mask (the first stroke on a fresh photo)', () => {
    const m = loadCutoutModules();
    const o = withPhoto(m);
    m.eraseLive.set(o.id, [stroke()]);
    const v = m.objView(o, { mask: 'em1' });
    assert.equal(v.node.a.mask, 'url(#em1)');
    assert.deepEqual(Array.from(v.defs.find(d => d.tag === 'mask').kids, k => k.tag), ['rect', 'path']);
  });

  await t.test('soft strokes get a blur, hard ones do not', () => {
    const m = loadCutoutModules();
    const o = withPhoto(m);
    const hard = m.eraseStrokeParts(stroke({ soft: 0 }), 'f', o), soft = m.eraseStrokeParts(stroke({ soft: 1 }), 'f', o);
    assert.equal(hard.defs.length, 0); assert.equal(hard.a.filter, null);
    assert.equal(soft.defs.length, 1); assert.equal(soft.a.filter, 'url(#f)');
    assert.equal(soft.defs[0].kids[0].a.stdDeviation, m.eraseSigma({ soft: 1, size: 20 }));
    assert.ok(m.eraseSigma({ soft: 1, size: 40 }) > m.eraseSigma({ soft: 0.5, size: 40 }));
    // the blur region reaches past the box so a stroke near the edge isn't cut off
    assert.ok(soft.defs[0].a.x < 0 && soft.defs[0].a.width > o.w);
  });

  await t.test('strokes are written as a dot first, then line segments', () => {
    const m = loadCutoutModules();
    assert.equal(m.erasePathStart(1.234, 5), 'M1.23 5L1.23 5');
    assert.equal(m.erasePathMore(7, 8.456), 'L7 8.46');
  });
});

test('erase: export', async (t) => {
  await t.test('the SVG has a mask definition and the photo group points at it', () => {
    const m = loadCutoutModules();
    const o = withPhoto(m, { erase: 'm1' });
    const svg = m.buildSVG([o], { x: 0, y: 0, w: 800, h: 600 }, 800, 600, null);
    assert.match(svg, /<defs><mask id="em1" maskUnits="userSpaceOnUse"/);
    assert.match(svg, /<g mask="url\(#em1\)">/);
    assert.ok(svg.includes(MASK), 'the mask picture is embedded');
    assert.ok(svg.includes(PIC), 'and so is the photo');
  });

  await t.test('two erased photos get their own masks', () => {
    const m = loadCutoutModules();
    const a = withPhoto(m, { erase: 'm1' });
    m.images.set('m2', { id: 'm2', w: 400, h: 200, dataUrl: 'data:image/png;base64,CC==', mask: true });
    const b = m.makeImage(m.images.get('p1'), { x: 300, y: 40, w: 200, h: 100, erase: 'm2' });
    const svg = m.buildSVG([a, b], { x: 0, y: 0, w: 800, h: 600 }, 800, 600, null);
    assert.match(svg, /<mask id="em1"/); assert.match(svg, /<mask id="em2"/);
    assert.ok(svg.includes('mask="url(#em1)"') && svg.includes('mask="url(#em2)"'));
  });

  await t.test('a photo that was never erased exports exactly as before', () => {
    const m = loadCutoutModules();
    const o = withPhoto(m);
    const svg = m.buildSVG([o], { x: 0, y: 0, w: 800, h: 600 }, 800, 600, null);
    assert.doesNotMatch(svg, /mask/);
  });

  await t.test('the stand-alone stroke SVG used for baking covers the photo box', () => {
    const m = loadCutoutModules();
    const o = withPhoto(m);
    const svg = m.eraseStrokeSVG(o, [stroke({ soft: 1 }), stroke({ restore: true })], 400, 200);
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="400" height="200" viewBox="0 0 200 100" preserveAspectRatio="none">/);
    assert.match(svg, /<filter id="ef0"/);
    assert.equal((svg.match(/<path /g) || []).length, 2);
    assert.ok(svg.includes('stroke="#000"') && svg.includes('stroke="#fff"'));
    assert.ok(svg.endsWith('</svg>'));
  });

  await t.test('pointer positions map into the photo box through a turn and a flip', () => {
    const m = loadCutoutModules();
    const o = withPhoto(m, { rot: 90, fx: true });
    const [wx, wy] = m.boxToWorld(o, 30, 70);
    const [bx, by] = m.worldToBox(o, wx, wy);
    assert.ok(Math.abs(bx - 30) < 1e-6 && Math.abs(by - 70) < 1e-6);
  });
});

test('erase: saving and opening', async (t) => {
  await t.test('an erased photo keeps its mask when a drawing is opened', () => {
    const m = loadCutoutModules();
    withPhoto(m);
    const d = m.sanitizeDoc({ w: 800, h: 600, objects: [{ kind: 'image', img: 'p1', erase: 'm1', x: 1, y: 2, w: 30, h: 20 }] });
    assert.equal(d.objects.length, 1);
    assert.equal(d.objects[0].erase, 'm1');
    assert.equal(d._missingPhoto, false);
  });

  await t.test('a missing mask picture is dropped and reported, and the photo itself survives', () => {
    const m = loadCutoutModules();
    m.images.set('p1', { id: 'p1', w: 400, h: 200, dataUrl: PIC });
    const d = m.sanitizeDoc({ w: 800, h: 600, objects: [{ kind: 'image', img: 'p1', erase: 'nope', x: 1, y: 2, w: 30, h: 20 }] });
    assert.equal(d.objects.length, 1);
    assert.equal(d.objects[0].erase, undefined);
    assert.equal(d._missingPhoto, true);
  });

  await t.test('the mask is part of the saved drawing text', () => {
    const m = loadCutoutModules();
    const o = withPhoto(m, { erase: 'm1' });
    assert.equal(JSON.parse(m.docJSON(m.doc)).objects[0].erase, 'm1');
    assert.equal(o.erase, 'm1');
  });

  await t.test('erasing is blocked while strokes are waiting to be saved', () => {
    const m = loadCutoutModules();
    const o = withPhoto(m);
    assert.equal(m.eraseBusy(), false);
    m.eraseLive.set(o.id, [stroke()]);
    assert.equal(m.eraseBusy(), true);
  });
});

test('erase: things that cannot carry an erased photo yet say so', async (t) => {
  await t.test('using an erased photo as a mask explains why not', () => {
    const m = loadCutoutModules({ recordToasts: true });
    const o = withPhoto(m, { erase: 'm1' });
    const r = m.newShape('rect', { x: 0, y: 0, w: 100, h: 100 });
    m.doc.objects.push(r);
    m.S.sel = new Set([o.id, r.id]);
    m.useAsMask();
    assert.equal(m.doc.objects.length, 2, 'nothing was changed');
    assert.equal(o.erase, 'm1');
    assert.equal(r.pic, undefined);
  });
});

// ---------------------------------------------------------------------------
// Brush / paint layers
// ---------------------------------------------------------------------------
// A paint layer covering a 800 x 600 page, with a picture of its own
function withLayer(m, props) {
  m.images.set('L1', { id: 'L1', w: 1600, h: 1200, dataUrl: 'data:image/png;base64,LL==' });
  const o = m.makeImage(m.images.get('L1'), Object.assign({ name: 'Paint layer', x: 0, y: 0, w: 800, h: 600, paint: true }, props));
  m.doc.objects.push(o);
  return o;
}
const paint = (extra) => Object.assign({ d: 'M10 10L10 10Q10 10 15 12', size: 30, soft: 0, alpha: 1, color: '#3b3bf5', paint: true, smooth: true, open: false }, extra);

test('paint: smooth strokes', async (t) => {
  await t.test('a new stroke starts as a dot', () => {
    const m = loadCutoutModules();
    const s = { smooth: true };
    m.strokeBegin(s, 10, 20);
    assert.equal(s.d, 'M10 20L10 20');
    assert.deepEqual(Array.from(s.last), [10, 20]);
  });

  await t.test('a smooth stroke curves through the midpoints between positions', () => {
    const m = loadCutoutModules();
    const s = { smooth: true };
    m.strokeBegin(s, 0, 0);
    m.strokeAdd(s, 10, 0);
    m.strokeAdd(s, 10, 10);
    assert.equal(s.d, 'M0 0L0 0Q0 0 5 0Q10 0 10 5');   // each curve is steered by the previous position and ends halfway to the next
    m.strokeEnd(s);
    assert.ok(s.d.endsWith('L10 10'), 'ends at the last position the pointer reached');
  });

  await t.test('a plain stroke (the eraser) just joins the positions, and ends where it is', () => {
    const m = loadCutoutModules();
    const s = {};
    m.strokeBegin(s, 0, 0); m.strokeAdd(s, 10, 0); m.strokeEnd(s);
    assert.equal(s.d, 'M0 0L0 0L10 0');
  });

  await t.test('a click without a drag is still a dot', () => {
    const m = loadCutoutModules();
    const s = { smooth: true }; m.strokeBegin(s, 4, 4); m.strokeEnd(s);
    assert.equal(s.d, 'M4 4L4 4L4 4');
  });
});

test('paint: how strokes are described', async (t) => {
  await t.test('a paint stroke is drawn in its own color, with opacity only when it is below 100%', () => {
    const m = loadCutoutModules();
    const o = withLayer(m);
    assert.equal(m.eraseStrokeParts(paint(), 'f', o).a.stroke, '#3b3bf5');
    assert.equal(m.eraseStrokeParts(paint(), 'f', o).a.opacity, null);
    assert.equal(m.eraseStrokeParts(paint({ alpha: 0.4 }), 'f', o).a.opacity, 0.4);
    assert.equal(m.eraseStrokeParts({ d: 'M0 0', size: 5, soft: 0 }, 'f', o).a.stroke, '#000', 'erasing is still black');
  });

  await t.test('pending paint strokes are drawn over the layer, after its picture', () => {
    const m = loadCutoutModules();
    const o = withLayer(m);
    m.eraseLive.set(o.id, [paint(), paint({ color: '#ff0000' })]);
    const v = m.objView(o, { mask: 'em1' });
    assert.deepEqual(Array.from(v.node.kids, k => k.tag), ['image', 'path', 'path']);
    assert.equal(v.node.kids[1].a.stroke, '#3b3bf5'); assert.equal(v.node.kids[2].a.stroke, '#ff0000');
    assert.equal(v.node.kids[1].a.transform, m.objXf(o), 'placed like the layer, so turns and flips carry over');
    assert.equal(v.node.a.mask, undefined, 'painting needs no mask');
  });

  await t.test('the layer\'s own opacity shows in the preview, as it will once the stroke is saved', () => {
    const m = loadCutoutModules();
    const o = withLayer(m, { opacity: 0.5 });
    m.eraseLive.set(o.id, [paint({ alpha: 0.5 })]);
    assert.equal(m.paintView(o, 'x').kids[0].a.opacity, 0.25);
  });

  await t.test('soft paint strokes get a blur with an id of their own', () => {
    const m = loadCutoutModules();
    const o = withLayer(m);
    m.eraseLive.set(o.id, [paint({ soft: 1 })]);
    const pv = m.paintView(o, 'em1');
    assert.equal(pv.defs[0].a.id, 'em1-p0');
    assert.equal(pv.kids[0].a.filter, 'url(#em1-p0)');
  });

  await t.test('paint and erase strokes pending on one layer stay apart: erasing goes in the mask, paint over the picture', () => {
    const m = loadCutoutModules();
    const o = withLayer(m);
    m.eraseLive.set(o.id, [paint(), { d: 'M1 1L1 1', size: 10, soft: 0, restore: false, open: false }]);
    const v = m.objView(o, { mask: 'em1' });
    const mask = v.defs.find(d => d.tag === 'mask');
    assert.deepEqual(Array.from(mask.kids, k => k.tag), ['rect', 'path'], 'one erase stroke in the mask');
    assert.equal(mask.kids[1].a.stroke, '#000');
    assert.equal(v.node.kids.filter(k => k.tag === 'path').length, 1, 'one paint stroke over the picture');
  });

  await t.test('a photo with no pending strokes is described exactly as before', () => {
    const m = loadCutoutModules();
    const o = withLayer(m);
    const v = m.objView(o, { mask: 'em1' });
    assert.equal(v.node.kids.length, 1); assert.equal(v.defs.length, 0);
  });

  await t.test('pending paint strokes count as busy, so undo waits for them', () => {
    const m = loadCutoutModules();
    const o = withLayer(m);
    assert.equal(m.eraseBusy(), false);
    m.eraseLive.set(o.id, [paint()]);
    assert.equal(m.eraseBusy(), true);
  });

  await t.test('paint strokes are exported into the stand-alone stroke SVG in color', () => {
    const m = loadCutoutModules();
    const o = withLayer(m);
    const svg = m.eraseStrokeSVG(o, [paint({ alpha: 0.5 })], 1600, 1200);
    assert.match(svg, /viewBox="0 0 800 600"/);
    assert.ok(svg.includes('stroke="#3b3bf5"') && svg.includes('opacity="0.5"'));
  });
});

test('paint: the layer itself', async (t) => {
  await t.test('its picture has two pixels per page unit, up to 1600 on the long side', () => {
    const m = loadCutoutModules();
    assert.deepEqual(Array.from(m.paintSize({ w: 800, h: 600 })), [1600, 1200]);
    assert.deepEqual(Array.from(m.paintSize({ w: 100, h: 100 })), [200, 200]);
    assert.deepEqual(Array.from(m.paintSize({ w: 4000, h: 3000 })), [1600, 1200]);
    assert.deepEqual(Array.from(m.paintSize({ w: 8000, h: 16 })), [1600, 3]);
  });

  await t.test('a layer that was never painted on is recognised by its 1 x 1 stand-in picture', () => {
    const m = loadCutoutModules();
    assert.equal(m.isBlankPaint({ w: 1, h: 1 }), true);
    assert.equal(m.isBlankPaint({ w: 5, h: 1, blank: true }), true);
    assert.equal(m.isBlankPaint(undefined), true);
    assert.equal(m.isBlankPaint({ w: 1600, h: 1200 }), false);
  });

  await t.test('its picture is not a photo, so it does not use up the photo limit', () => {
    const m = loadCutoutModules();
    withLayer(m);
    m.images.set('p1', { id: 'p1', w: 10, h: 10, dataUrl: 'data:,' });
    m.doc.objects.push(m.makeImage(m.images.get('p1'), {}));
    assert.deepEqual([...m.docImageIds(m.doc)].sort(), ['L1', 'p1']);
    assert.deepEqual([...m.docPhotoIds(m.doc)], ['p1']);
  });

  await t.test('it shows a brush icon and a name in the Layers list', () => {
    const m = loadCutoutModules();
    const o = withLayer(m);
    assert.equal(m.iconFor(o), 'brush');
    assert.equal(m.labelOf(o), 'Paint layer');
    assert.equal(m.iconFor(m.makeImage({ id: 'x', w: 1, h: 1, name: 'Cat' }, {})), 'image');
  });

  await t.test('opening a drawing keeps the layer a paint layer', () => {
    const m = loadCutoutModules();
    m.images.set('L1', { id: 'L1', w: 1600, h: 1200, dataUrl: 'data:,' });
    const d = m.sanitizeDoc({ w: 800, h: 600, objects: [{ kind: 'image', img: 'L1', paint: true, x: 0, y: 0, w: 800, h: 600 }, { kind: 'image', img: 'L1', x: 0, y: 0, w: 5, h: 5 }] });
    assert.equal(d.objects[0].paint, true);
    assert.equal(d.objects[1].paint, undefined, 'only layers that were paint layers');
  });

  await t.test('a paint layer is saved with the drawing', () => {
    const m = loadCutoutModules();
    withLayer(m);
    assert.equal(JSON.parse(m.docJSON(m.doc)).objects[0].paint, true);
  });

  await t.test('it can be used as a photo mask like any picture', () => {
    const m = loadCutoutModules({ recordToasts: true });
    const o = withLayer(m);
    const r = m.newShape('rect', { x: 0, y: 0, w: 100, h: 100 });
    m.doc.objects.push(r); m.S.sel = new Set([o.id, r.id]);
    m.useAsMask();
    assert.equal(r.pic.id, 'L1');
  });
});
