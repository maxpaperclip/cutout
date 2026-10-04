/* =====================================================================
   Editing text in place
   Text is drawn as outlines (see buildText in 04-document-model.js), so there is nothing on the canvas to
   type into. While a text object is being edited, a see-through <textarea> sits exactly over it, set in
   the same font, size, spacing and angle. The browser supplies the caret, the selection and the keyboard
   handling; every keystroke goes into o.text and the outlines underneath are rebuilt as you type.
   Editing ends with Esc or a click anywhere else, as one undo step. Text that ends up empty is removed.
   A new text object is only added to the undo history when editing ends, so Undo takes it away whole.
   The Design tab's own text box still works; the two never edit at once.
   ===================================================================== */
const TE_PAD = 16;                 // room around the box (screen pixels), so the caret at either end is never cut off
let te = null;                     // the edit in progress: { id, isNew, before }
const teEl = $('#text-edit');
// The browser needs the font itself to lay text out the way the outlines were (see fontFaceReady in 03-fonts-runtime.js)
const teFontReady = fontFaceReady;
const teFontKey = o => fonts[o.font] ? o.font : DEFAULT_FONT;

// Put the box over the object, at the canvas's current zoom and position
function tePlace() {
  const o = te && byId(te.id);
  if (!o) return;
  const z = view.z, sr = stage.getBoundingClientRect(), hr = teEl.offsetParent.getBoundingClientRect();
  const st = teEl.style;
  st.left = rnd(sr.left - hr.left + view.x + o.x * z - TE_PAD, 2) + 'px';
  st.top = rnd(sr.top - hr.top + view.y + o.y * z - TE_PAD, 2) + 'px';
  st.width = rnd(o.w * z + TE_PAD * 2, 2) + 'px';
  st.height = rnd(o.h * z + TE_PAD * 2, 2) + 'px';
  st.padding = TE_PAD + 'px';
  st.fontFamily = "'" + cssFamily(teFontKey(o)) + "', sans-serif";
  st.fontSize = rnd(o.size * z, 3) + 'px';
  st.lineHeight = rnd(o.size * o.lh * z, 3) + 'px';
  st.letterSpacing = rnd((o.ls || 0) * o.size * z, 3) + 'px';
  st.textAlign = o.align || 'left';
  st.transform = o.rot ? 'rotate(' + o.rot + 'deg)' : 'none';
  teEl.scrollLeft = 0; teEl.scrollTop = 0;
}
function teOverlay() {
  const o = byId(te.id);
  if (!o) return false;
  const c = centerOf(o);
  ov.appendChild(svgEl('rect', { x: o.x, y: o.y, width: o.w, height: o.h, class: 'ov-line ov-dash', transform: o.rot ? 'rotate(' + o.rot + ' ' + c.x + ' ' + c.y + ')' : null }));
  return true;   // no handles while typing
}

function startTextEdit(o, isNew) {
  if (te) finishTextEdit();
  if (!o || o.kind !== 'text') return;
  if (isLocked(o) || isHidden(o) || o.fx || o.fy) {   // a mirrored text can't be typed over: use the Design tab
    if (isNew) commit();
    S.sel = new Set([o.id]); refreshAll(); openPanel(); focusText();
    return;
  }
  S.sel = new Set([o.id]);
  te = { id: o.id, isNew: !!isNew, before: o.text };
  teEl.value = o.text; teEl.hidden = false;
  refreshAll(); tePlace();
  teFontReady(teFontKey(o)).then(() => { if (te && te.id === o.id) tePlace(); });
  setTimeout(() => { if (te && te.id === o.id) { teEl.focus(); teEl.select(); } }, 30);   // after the click that started it is over
}
function finishTextEdit() {
  if (!te) return;
  const t = te; te = null;
  teEl.hidden = true;
  const o = byId(t.id);
  if (o && !o.text.trim()) {
    if (t.isNew) { doc.objects = doc.objects.filter(x => x.id !== o.id); S.sel.delete(o.id); refreshAll(); }   // never in the history
    else { S.sel = new Set([o.id]); deleteSelected(); }
    return;
  }
  if (o && (t.isNew || o.text !== t.before)) commit();
  refreshAll();
}

teEl.addEventListener('input', () => {
  const o = te && byId(te.id);
  if (!o) return;
  o.text = teEl.value; refresh(o);
  render(); renderLayers(); tePlace();
  $('#tx-text').value = o.text;
});
teEl.addEventListener('keydown', e => {
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); e.stopPropagation(); finishTextEdit(); stage.focus({ preventScroll: true }); return; }
  const sk = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (sk === 'b' || sk === 'i')) { e.preventDefault(); e.stopPropagation(); toggleStyle(sk === 'b' ? 'bold' : 'italic', true); return; }   // the one shortcut that works while typing
  e.stopPropagation();   // typing is never a shortcut
});
teEl.addEventListener('blur', () => finishTextEdit());
// Scrolling and pinching over the text still move the canvas
teEl.addEventListener('wheel', e => { e.preventDefault(); stage.dispatchEvent(new WheelEvent('wheel', e)); }, { passive: false });
window.addEventListener('resize', () => { if (te) tePlace(); });
