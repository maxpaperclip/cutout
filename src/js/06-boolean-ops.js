/* =====================================================================
   Boolean operations (paper.js)
   ===================================================================== */
function localPaper(o) {
  if (o.kind === 'rect') return new paper.Path.Rectangle({ point: [0, 0], size: [o.w, o.h], radius: Math.min(o.r || 0, o.w / 2, o.h / 2), insert: false });
  if (o.kind === 'ellipse') return new paper.Path.Ellipse({ center: [o.w / 2, o.h / 2], radius: [o.w / 2, o.h / 2], insert: false });
  return new paper.CompoundPath({ pathData: o.d, insert: false });
}
function worldPaper(o) {
  const item = localPaper(o);
  if (o.fx || o.fy) item.scale(o.fx ? -1 : 1, o.fy ? -1 : 1, new paper.Point(o.w / 2, o.h / 2));
  if (o.rot) item.rotate(o.rot, new paper.Point(o.w / 2, o.h / 2));
  item.translate(new paper.Point(o.x, o.y));
  return item;
}
const BOOL_NAME = { unite: 'United shape', subtract: 'Subtracted shape', intersect: 'Intersection', exclude: 'Exclusion' };
// Combine shapes (bottom-most first) into one new path object, or return null after explaining why not
function combineShapes(op, list) {
  try {
    let acc = worldPaper(list[0]);
    for (let i = 1; i < list.length; i++) {
      const b = worldPaper(list[i]);
      acc = op === 'unite' ? acc.unite(b, { insert: false })
        : op === 'subtract' ? acc.subtract(b, { insert: false })
        : op === 'intersect' ? acc.intersect(b, { insert: false })
        : acc.exclude(b, { insert: false });
    }
    const bn = acc.bounds;
    if (acc.isEmpty() || (bn.width < 0.01 && bn.height < 0.01)) {
      toast(op === 'intersect' ? 'Those shapes don\u2019t overlap, so there is nothing to keep.' : 'Nothing would be left, so the shapes were not changed.');
      return null;
    }
    acc.translate(new paper.Point(-bn.x, -bn.y));
    const base = list[0], d = acc.pathData;
    const res = newShape('path', { name: BOOL_NAME[op], x: bn.x, y: bn.y, w: bn.width, h: bn.height, nat: { d, w: bn.width, h: bn.height } });
    // The result looks like the bottom shape; its gradient is stretched over the combined shape's box
    return copyKeys(base, res, STYLE_KEYS);
  } catch (err) {
    console.error(err);
    toast('Those shapes could not be combined. Try simplifying them first.');
    return null;
  }
}
// Swap the listed objects for one new object, placed where the bottom-most of them was
function replaceObjects(list, res) {
  const at = doc.objects.indexOf(list[0]), gone = new Set(list.map(o => o.id));
  if (list[0].parent !== undefined) res.parent = list[0].parent;   // stays in the bottom shape's group
  doc.objects = doc.objects.filter(o => !gone.has(o.id));
  doc.objects.splice(Math.min(at, doc.objects.length), 0, res);
  S.sel = new Set([res.id]);
}
function runBoolean(op) {
  const list = doc.objects.filter(o => S.sel.has(o.id));
  if (list.length < 2) { toast('Select two or more shapes first.'); return; }
  if (list.some(hasPixels)) { toast('Photos can\u2019t be combined like shapes. Use \u201cUse shapes as mask\u201d to put a photo inside a shape.'); return; }
  if (list.some(isOpenPath)) { toast('Lines have no inside, so they can\u2019t be combined. To draw a shape, end a drawn line where it started, or use the Pen and click the first point.'); return; }
  const res = combineShapes(op, list);
  if (!res) return;
  const hadPhoto = list.some(hasPic);
  replaceObjects(list, res);
  commit();
  if (hadPhoto) toast('Combined. Photo fills are not kept when shapes are combined.');
}
function flattenSelected() {
  const o = one();
  if (!o || !kindInfo(o).plain) return;
  const d = o.kind === 'rect' || o.kind === 'ellipse' ? localPaper(o).pathData : o.d;
  toPlainPath(o, d, o.w, o.h);
  if (!o.name) o.name = 'Shape';
  commit();
  toast('Converted to a plain shape.');
}

/* ---------- photo masks ---------- */
// Put the selected photo inside the selected shape(s). The photo stays exactly where it was
// on the page when the shape and photo are lined up the same way; otherwise it is centered.
function useAsMask() {
  const sel = doc.objects.filter(o => S.sel.has(o.id));
  const pics = sel.filter(hasPixels), shapes = sel.filter(hasPaint);
  if (pics.length !== 1 || !shapes.length) { toast('Select one photo and the shape or text you want to use as the mask.'); return; }
  if (shapes.some(isOpenPath)) { toast('Lines have no inside, so they can\u2019t be masks. Use a shape instead.'); return; }
  const im = pics[0], rec = images.get(im.img);
  if (!rec) { toast('That photo is not available any more.'); return; }
  if (im.erase) { toast('Photos with erased parts can\u2019t be used as a mask yet. Choose Restore all in the Eraser section first.'); return; }
  let target = shapes[0];
  if (shapes.length > 1) { target = combineShapes('unite', shapes); if (!target) return; }
  let dx = 0, dy = 0, s = coverScale(target, rec);
  const aligned = normDeg(im.rot - target.rot) === 0 && !!im.fx === !!target.fx && !!im.fy === !!target.fy;
  if (aligned) {
    const ic = centerOf(im), tc = centerOf(target);
    const r = rotPt(ic.x - tc.x, ic.y - tc.y, 0, 0, -target.rot);
    dx = target.fx ? -r.x : r.x; dy = target.fy ? -r.y : r.y; s = im.w / rec.w;
  }
  target.pic = { id: im.img, dx: rnd(dx, 3), dy: rnd(dy, 3), s: s };
  if (shapes.length > 1) replaceObjects(shapes, target);
  else S.sel = new Set([target.id]);
  doc.objects = doc.objects.filter(o => o.id !== im.id);
  commit();
  toast(aligned ? 'Photo masked. Use Move and Zoom to reposition it.' : 'Photo masked and centered. Use Move and Zoom to reposition it.');
}
// Take the photo back out of a masked shape as its own object, exactly where it appeared
function releaseMask() {
  const o = one();
  if (!o || !hasPic(o)) return;
  const rec = images.get(o.pic.id), pw = rec.w * o.pic.s, ph = rec.h * o.pic.s;
  const r = rotPt(o.fx ? -o.pic.dx : o.pic.dx, o.fy ? -o.pic.dy : o.pic.dy, 0, 0, o.rot), c = centerOf(o);
  const im = makeImage(rec, { x: c.x + r.x - pw / 2, y: c.y + r.y - ph / 2, w: pw, h: ph, rot: o.rot });
  copyKeys(o, im, ['fx', 'fy', 'parent']);
  delete o.pic;
  doc.objects.splice(doc.objects.indexOf(o), 0, im);
  S.sel = new Set([im.id, o.id]);
  commit();
  toast('Mask released. The photo is a separate object again.');
}
function fitPhoto() {
  const o = one();
  if (!o || !hasPic(o)) return;
  o.pic = { id: o.pic.id, dx: 0, dy: 0, s: coverScale(o, images.get(o.pic.id)) };
  commit();
}

