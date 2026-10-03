/* =====================================================================
   Brush tool
   Paints with a soft or hard brush on a paint layer. A paint layer is a picture the size of the page
   that sits in the drawing like a photo; if no paint layer is selected (and none is on top), the first
   stroke makes one. Strokes are drawn and saved exactly as the Eraser's are (see 09c-eraser.js and
   04d-erase.js): a colored vector path while it is drawn, baked into the layer's picture when the
   pointer lifts, one undo step each. Size and softness are shared with the Eraser; the color and
   opacity are the Brush's own. The Eraser rubs paint back out of a paint layer.
   ===================================================================== */
const PB = { color: '#3b3bf5', alpha: 1 };   // opacity is 0 to 1, for the whole stroke (overlaps within a stroke don't add up)

// A new layer shows this clear 1 x 1 picture until its first stroke has been saved
const BLANK_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
function blankPaintRecord() {
  const bin = atob(BLANK_PNG), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const blob = new Blob([u], { type: 'image/png' });
  return { id: uid(), blob, dataUrl: 'data:image/png;base64,' + BLANK_PNG, w: 1, h: 1, mime: 'image/png', bytes: blob.size, name: 'Paint layer', stored: false, blank: true };
}
// A paint layer covering the page, on top of everything. It joins the undo history with its first stroke.
function newPaintLayer() {
  const rec = blankPaintRecord();
  images.set(rec.id, rec);
  const o = makeImage(rec, { name: 'Paint layer', x: 0, y: 0, w: doc.w, h: doc.h, paint: true });
  doc.objects.push(o);
  return o;
}
// Where the next stroke goes: the selected paint layer, or, with nothing selected, the paint layer on top.
// Anything else (a photo or shape selected, or several things) gets a new layer.
function brushTarget() {
  const sel = selObjs();
  if (sel.length === 1) return sel[0].paint ? sel[0] : null;
  const top = doc.objects[doc.objects.length - 1];
  return !sel.length && top && top.paint && !isLocked(top) && !isHidden(top) ? top : null;
}
function brushDown(e, p) {
  let o = brushTarget();
  if (o && (isLocked(o) || isHidden(o))) { toast(isHidden(o) ? 'Show this layer to paint on it.' : 'Unlock this layer to paint on it.'); return; }
  if (!o) o = newPaintLayer();
  if (S.sel.size !== 1 || !S.sel.has(o.id)) { S.sel = new Set([o.id]); renderLayers(); updateInspector(); }
  const q = worldToBox(o, p.x, p.y);
  const stroke = { paint: true, smooth: true, color: PB.color, alpha: PB.alpha, size: ER.size, soft: ER.soft, open: true };
  strokeBegin(stroke, q[0], q[1]);
  if (!eraseLive.has(o.id)) eraseLive.set(o.id, []);
  eraseLive.get(o.id).push(stroke);
  drag = { type: 'brush', id: o.id, stroke, last: q };
  eraserPos = p;
  syncObjects(); drawOverlay();
}
function brushOverlay() {
  $('#erase-hint').textContent = brushTarget() ? 'Drag to paint on the selected layer.' : 'Drag to paint. A new paint layer is made for you.';
  strokeRing();
  return true;   // no selection handles while painting
}
TOOLS.brush = {
  key: 'k', cursor: 'draw',
  down: brushDown,
  hover(e, p) { eraserPos = p; drawOverlay(); },
  overlay: brushOverlay,
  enter() { openStrokeBar('brush'); },
  leave() { $('#erase-bar').hidden = true; eraserPos = null; }
};
DRAGS.brush = { move: p => eraserMove(p), end: d => eraserEnd(d), cancel: d => eraserCancel(d) };

/* ---------- controls (the bar itself is shared with the Eraser, see openStrokeBar) ---------- */
$('#br-color').value = PB.color; $('#br-alpha').value = Math.round(PB.alpha * 100);
$('#br-color').addEventListener('input', e => { PB.color = e.target.value; });
$('#br-alpha').addEventListener('input', e => { PB.alpha = clamp((+e.target.value || 100) / 100, 0.05, 1); });
