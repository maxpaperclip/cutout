/* =====================================================================
   Eyedropper tool
   The little dropper next to a color (fill, outline, gradient color, page background, brush) picks a
   color from the drawing. It is a temporary tool: choose the dropper, click on the canvas, and the
   color goes into the field it was chosen from and the tool you had comes back. Esc or Cancel
   backs out. The color is read from a picture of the canvas as it looks on screen (all layers,
   opacity and blend modes), either from one pixel or as the average of the 3 x 3 pixels around it.
   The sums are in 04e-eyedrop.js. On a touch screen, drag to refine and lift to pick.
   ===================================================================== */
const ED = { n: 1 };                  // 1: the pixel under the pointer; 3: the average of the 3 x 3 around it
let edTarget = null, edBack = 'select', edReopen = false;   // the field to fill, the tool to return to, whether to bring the panel back
let edShot = null, edRun = 0, edTimer = null, edJob = null;   // the picture of the canvas, and the one being drawn
let edAt = null;                      // the pointer: { sx, sy (on the canvas), cx, cy (on the screen) }

const edKey = () => { const s = stageSize(); return [view.x, view.y, view.z, s.w, s.h].map(v => rnd(v, 3)).join(','); };
const edFresh = () => !!edShot && edShot.key === edKey();

// Draw the canvas's current view as a picture and keep its pixels. The page color goes under everything
// (inside the SVG, so blend modes mix with it as they do on screen), but only on the page itself.
function edRender() {
  clearTimeout(edTimer); edTimer = null;
  const run = ++edRun, key = edKey(), s = stageSize(), region = dropRegion(s, view);
  edShot = null;
  let svg = buildSVG(doc.objects, region.box, region.W, region.H, null);
  if (doc.bg !== 'transparent') svg = svg.replace(/^<svg[^>]*>/, m => m + '<rect x="0" y="0" width="' + doc.w + '" height="' + doc.h + '" fill="' + esc(doc.bg) + '"/>');
  edJob = loadImage(svgDataUrl(svg)).then(img => {
    if (run !== edRun) return;
    const cv = document.createElement('canvas'); cv.width = region.W; cv.height = region.H;
    try {
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, region.W, region.H);
      edShot = { key, region, W: region.W, H: region.H, data: ctx.getImageData(0, 0, region.W, region.H).data };
    } finally { cv.width = cv.height = 0; }
  }).catch(() => {
    if (run !== edRun) return;
    toast('The colors could not be read from the drawing. Try zooming out or using a smaller photo.');
    edFinish(null);
  }).then(() => { if (run === edRun) { edTip(); drawOverlay(); } });
  return edJob;
}
// The picture is out of date when the view has changed: draw it again once the view settles
function edWatch() { if (!edFresh() && !edTimer) { edShot = null; edTimer = setTimeout(edRender, 150); } }
async function edReady() { if (!edFresh()) await edRender(); else if (edJob) await edJob; return edFresh(); }

// The color under a point of the canvas, or null (no picture yet, or nothing there)
function edSample(a) {
  if (!a || !edFresh()) return null;
  const p = dropPixel(edShot.region, a.sx, a.sy);
  const c = dropAverage(edShot.data, edShot.W, edShot.H, p.x, p.y, ED.n);
  return c.a > 0 ? c : null;
}
function edPoint(e) { const r = stage.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top, cx: e.clientX, cy: e.clientY }; }

/* ---------- what is shown ---------- */
// The swatch that follows the pointer
function edTip() {
  const tip = $('#drop-tip');
  if (S.tool !== 'eyedropper' || !edAt) { tip.hidden = true; return; }
  const c = edSample(edAt);
  tip.hidden = false;
  tip.querySelector('i').style.background = c ? dropHex(c) : 'transparent';
  tip.querySelector('b').textContent = c ? dropHex(c) : edFresh() ? 'Nothing here' : '…';
  const w = tip.offsetWidth, r = stage.getBoundingClientRect();
  tip.style.left = Math.round(Math.min(edAt.cx + 18, r.right - w - 6)) + 'px';
  tip.style.top = Math.round(edAt.cy + 18 > r.bottom - 40 ? edAt.cy - 44 : edAt.cy + 18) + 'px';
}
// The pixels being read, outlined on the canvas
function edOverlay() {
  $('#drop-hint').textContent = ED.n === 3 ? 'Click to pick the average color of the 3 × 3 pixels there.' : 'Click to pick the color of the pixel there.';
  edWatch();
  if (edAt) {
    const k = edShot ? edShot.region.k : 1, p = edShot ? dropPixel(edShot.region, edAt.sx, edAt.sy) : { x: Math.floor(edAt.sx), y: Math.floor(edAt.sy) };
    const x0 = (p.x / k - (ED.n === 3 ? 1 : 0) - view.x) / view.z, y0 = (p.y / k - (ED.n === 3 ? 1 : 0) - view.y) / view.z, s = ED.n / view.z;
    const at = { x: x0, y: y0, width: s, height: s };
    ov.appendChild(svgEl('rect', Object.assign({ class: 'er-ring-a' }, at)));
    ov.appendChild(svgEl('rect', Object.assign({ class: 'er-ring-b' }, at)));
  }
  return true;   // no selection handles while picking
}
function edMode(n) {
  ED.n = n;
  $('#drop-1').setAttribute('aria-pressed', String(n === 1)); $('#drop-3').setAttribute('aria-pressed', String(n === 3));
  edTip(); drawOverlay();
}

/* ---------- picking ---------- */
// Leave the tool; if there is a color, put it in the field the dropper was chosen from
function edFinish(hex) {
  const field = edTarget, back = edBack, reopen = edReopen;
  setTool(TOOLS[back] && back !== 'eyedropper' ? back : 'select');
  if (reopen) openPanel();
  if (!hex || !field) return;
  const el = $(field);
  if (!el) return;
  el.value = hex;   // the same events a person's own choice sends, so the field behaves just as it does then
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  toast('Picked ' + hex + '.');
}
async function edPick(e) {
  const a = edPoint(e);
  if (!(await edReady()) || S.tool !== 'eyedropper') return;
  const c = edSample(a);
  if (!c) { toast('There is no color there. Click on something in the drawing.'); return; }
  edFinish(dropHex(c));
}
function startEyedropper(field) {
  if (S.tool === 'eyedropper') { if (edTarget === field) edFinish(null); else edTarget = field; return; }
  edBack = S.tool; edTarget = field;
  edReopen = matchMedia('(max-width: 820px)').matches && $('#panel').classList.contains('open');   // on a small screen the panel covers the canvas
  if (edReopen) { $('#panel').classList.remove('open'); $('#btn-panel').setAttribute('aria-pressed', 'false'); }
  setTool('eyedropper');
}

TOOLS.eyedropper = {
  cursor: 'draw',   // no shortcut key: it is started from a color, and returns to the tool you were using
  down(e) { drag = { type: 'eyedrop' }; edAt = edPoint(e); edTip(); drawOverlay(); },
  hover(e) { edAt = edPoint(e); edTip(); drawOverlay(); },
  overlay: edOverlay,
  keys(e) {
    if (e.key === 'Escape') { e.preventDefault(); edFinish(null); return true; }
    if (e.key === '1' || e.key === '3') { edMode(+e.key); return true; }
    return e.ctrlKey || e.metaKey;   // undo and the like would change what is being read
  },
  enter() { $('#drop-bar').hidden = false; edMode(ED.n); edAt = null; edRender(); },
  leave() {
    $('#drop-bar').hidden = true; $('#drop-tip').hidden = true;
    edRun++; clearTimeout(edTimer); edTimer = null; edShot = null; edAt = null; edTarget = null;   // a picture still being drawn is dropped
  }
};
DRAGS.eyedrop = {
  move(p, e) { edAt = edPoint(e); edTip(); drawOverlay(); },
  end(d, e) { if (e && e.type === 'pointercancel') { drawOverlay(); return; } edPick(e); },
  cancel() { /* a second finger: the pick is abandoned and the pinch goes on */ }
};
stage.addEventListener('pointerleave', () => { if (S.tool === 'eyedropper' && !drag) { edAt = null; edTip(); drawOverlay(); } });

/* ---------- controls ---------- */
$$('[data-eyedrop]').forEach(b => b.addEventListener('click', () => startEyedropper(b.dataset.eyedrop)));
$('#drop-1').addEventListener('click', () => edMode(1));
$('#drop-3').addEventListener('click', () => edMode(3));
$('#drop-cancel').addEventListener('click', () => edFinish(null));
