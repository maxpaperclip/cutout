/* =====================================================================
   Eraser tool
   Select a photo and drag over it to hide parts of it; hold Alt (or turn on Restore) to bring parts
   back. Nothing is ever deleted from the photo: the strokes go into a mask picture kept beside it
   (see 04d-erase.js for how that is described and drawn).
   A stroke is shown as a vector path inside the mask while it is drawn. When the pointer lifts it is
   baked into a new mask picture, the object points at that picture, and one undo step is recorded.
   Strokes are baked one at a time, in order, so a fast second stroke just waits its turn.
   ===================================================================== */
const ER = { size: 40, soft: 0.35, restore: false };   // the brush; size is in page units, soft is 0 (hard) to 1
let eraserPos = null;                                   // where the pointer is, in page coordinates (for the brush ring)
const ER_MIN_STEP = 0.8;                                // ignore pointer moves smaller than this (screen pixels)

// The photo to erase: the selected one, or else the one under the pointer
function eraseTarget(e) {
  const sel = selObjs();
  if (sel.length === 1 && canErase(sel[0])) return sel[0];
  const g = e.target.closest && e.target.closest('[data-id]');
  const o = g ? byId(+g.dataset.id) : null;
  return canErase(o) ? o : null;
}
function eraserDown(e, p) {
  const o = eraseTarget(e);
  if (!o) { toast('Select a photo, then drag over it to erase parts of it.'); return; }
  if (isLocked(o) || isHidden(o)) { toast(isHidden(o) ? 'Show this photo to erase parts of it.' : 'Unlock this photo to erase parts of it.'); return; }
  if (S.sel.size !== 1 || !S.sel.has(o.id)) { S.sel = new Set([o.id]); renderLayers(); updateInspector(); }
  const q = worldToBox(o, p.x, p.y);
  const stroke = { d: erasePathStart(q[0], q[1]), size: ER.size, soft: ER.soft, restore: ER.restore !== e.altKey, open: true };   // Alt flips Restore
  if (!eraseLive.has(o.id)) eraseLive.set(o.id, []);
  eraseLive.get(o.id).push(stroke);
  drag = { type: 'eraser', id: o.id, stroke, last: q };
  eraserPos = p;
  syncObjects(); drawOverlay();
}
function eraserMove(p) {
  eraserPos = p;
  const o = byId(drag.id);
  if (o) {
    const q = worldToBox(o, p.x, p.y), l = drag.last;
    if (Math.hypot(q[0] - l[0], q[1] - l[1]) * view.z >= ER_MIN_STEP) {
      drag.last = q; drag.stroke.d += erasePathMore(q[0], q[1]);
      syncObjects();
    }
  }
  drawOverlay();
}
function eraserEnd(d) {
  d.stroke.open = false;
  runEraseQueue();
  drawOverlay();
}
// A second finger arrived: the stroke was never meant, so drop it
function eraserCancel(d) { dropStroke(d.id, d.stroke); syncObjects(); }
function dropStroke(id, s) {
  const list = eraseLive.get(id); if (!list) return;
  const i = list.indexOf(s); if (i >= 0) list.splice(i, 1);
  if (!list.length) eraseLive.delete(id);
}

/* ---------- saving strokes into the mask picture ---------- */
let eraseRunning = false;
async function runEraseQueue() {
  if (eraseRunning) return;
  eraseRunning = true;
  try {
    for (;;) {
      let job = null;
      eraseLive.forEach((list, id) => { if (!job && list.length && !list[0].open) job = { id, s: list[0] }; });
      if (!job) break;
      await bakeStroke(job.id, job.s);
    }
  } finally { eraseRunning = false; }
}
async function bakeStroke(id, s) {
  const d0 = doc;
  try {
    const o = byId(id);
    if (!o) { dropStroke(id, s); return; }
    const rec = await makeEraseRecord(o, [s]);
    const o2 = byId(id);
    if (doc !== d0 || !o2) { dropStroke(id, s); return; }   // the drawing was swapped for another while this was saved
    images.set(rec.id, rec);
    o2.erase = rec.id;
    dropStroke(id, s);
    commit({ bytes: rec.bytes * 3 });   // the file and its data URL are both held in memory until the step is dropped
  } catch (err) {
    dropStroke(id, s); syncObjects();
    toast('That stroke could not be saved. Try a smaller photo or a smaller brush.');
  }
}
// A mask picture: the object's current mask (or all white) with the strokes painted on top.
// The strokes are drawn by the browser from the same SVG the canvas shows, so the result matches the preview.
async function makeEraseRecord(o, strokes) {
  const old = o.erase ? images.get(o.erase) : null, base = hasPixels(o) ? images.get(o.img) : null;
  const w = old ? old.w : base ? base.w : clamp(Math.round(o.w), 1, LIMITS.edge);
  const h = old ? old.h : base ? base.h : clamp(Math.round(o.h), 1, LIMITS.edge);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  try {
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    if (old) ctx.drawImage(await loadPicture(old.dataUrl), 0, 0, w, h);
    ctx.drawImage(await loadPicture(svgDataUrl(eraseStrokeSVG(o, strokes, w, h))), 0, 0, w, h);
    const blob = await canvasBlob(cv, 'image/png');
    if (!blob) throw new Error('The mask could not be saved.');
    return { id: uid(), blob, dataUrl: await readDataUrl(blob), w, h, mime: 'image/png', bytes: blob.size, name: 'Erased areas', stored: false, mask: true };
  } finally { cv.width = cv.height = 0; }
}
// Bring everything back
function restoreAllErased() {
  const o = one();
  if (!o || !o.erase) return;
  delete o.erase;
  commit(); toast('Everything that was erased is back.');
}

/* ---------- the tool ---------- */
// The brush ring, and an outline around the photo being erased (called from drawOverlay)
function eraserOverlay() {
  const o = one() && canErase(one()) ? one() : null;
  $('#erase-hint').textContent = !o ? 'Select a photo to erase parts of it.'
    : ER.restore ? 'Drag to bring erased parts back. Hold Alt to erase instead.'
    : 'Drag to erase. Hold Alt, or turn on Restore, to bring erased parts back.';
  if (o) {
    const c = centerOf(o);
    ov.appendChild(svgEl('rect', { x: o.x, y: o.y, width: o.w, height: o.h, class: 'ov-line ov-dash', transform: o.rot ? 'rotate(' + o.rot + ' ' + c.x + ' ' + c.y + ')' : null }));
  }
  if (eraserPos) {
    const live = drag && drag.type === 'eraser' ? drag.stroke : null, restore = live ? live.restore : ER.restore, dash = restore ? '5 4' : null;
    const at = { cx: eraserPos.x, cy: eraserPos.y, r: ER.size / 2, 'stroke-dasharray': dash };
    ov.appendChild(svgEl('circle', Object.assign({ class: 'er-ring-a' }, at)));
    ov.appendChild(svgEl('circle', Object.assign({ class: 'er-ring-b' }, at)));
  }
  return true;   // no selection handles while erasing
}
TOOLS.eraser = {
  key: 'x', cursor: 'draw',
  down: eraserDown,
  hover(e, p) { eraserPos = p; drawOverlay(); },
  overlay: eraserOverlay,
  enter() { $('#erase-bar').hidden = false; },
  leave() { $('#erase-bar').hidden = true; eraserPos = null; }
};
DRAGS.eraser = { move: p => eraserMove(p), end: d => eraserEnd(d), cancel: d => eraserCancel(d) };
stage.addEventListener('pointerleave', () => { if (S.tool === 'eraser' && !drag && eraserPos) { eraserPos = null; drawOverlay(); } });

/* ---------- controls ---------- */
const showEraseSize = () => { $('#er-size-out').textContent = ER.size; };
$('#er-size').value = ER.size; $('#er-soft').value = Math.round(ER.soft * 100); showEraseSize();
$('#er-size').addEventListener('input', e => { ER.size = clamp(+e.target.value || ERASE.minSize, ERASE.minSize, ERASE.maxSize); showEraseSize(); drawOverlay(); });
$('#er-soft').addEventListener('input', e => { ER.soft = clamp((+e.target.value || 0) / 100, 0, 1); });
$('#er-restore').addEventListener('click', () => { ER.restore = !ER.restore; $('#er-restore').setAttribute('aria-pressed', String(ER.restore)); drawOverlay(); });
$('#erase-done').addEventListener('click', () => { setTool('select'); refreshAll(); });
$('#btn-erase-tool').addEventListener('click', () => setTool('eraser'));
$('#btn-erase-reset').addEventListener('click', restoreAllErased);
