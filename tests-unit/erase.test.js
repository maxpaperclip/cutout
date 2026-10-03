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
