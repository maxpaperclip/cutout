/* =====================================================================
   Editing text in place
   Text is drawn as outlines (see buildText in 04-document-model.js), so there is nothing on the canvas to
   type into. While a text object is being edited, an invisible <textarea> takes the keyboard: typing, the
   arrow keys, copy and paste, input methods, phone keyboards. The caret and the highlighted selection are
   not the browser's: they are drawn over the text here, from the same layout the outlines come from
   (textLayout, in 04f-text-layout.js). The browser never lays the text out, so the caret cannot drift from
   the letters, whatever the zoom, angle, font or length. (Pressing on the text places the caret or selects,
   a double-click picks a word, a triple-click a line.)
   Every keystroke goes into o.text and the outlines underneath are rebuilt as you type.
   Color, size, font, letter spacing and line height apply to the selected letters (see 04g-text-runs.js); with only a caret they are kept for the
   letters typed next. The style controls in the Design tab do not end the edit; the rest of the page does.
   Editing ends with Esc, Ctrl+Enter or a click anywhere else, as one undo step. Text that ends up empty is removed.
   A new text object is only added to the undo history when editing ends, so Undo takes it away whole.
   The Design tab's own text box still works; the two never edit at once.
   ===================================================================== */
const TE_PAD = 8;                  // a press this close (screen pixels) outside the text's box still counts as on it
let te = null;                     // the edit in progress: { id, isNew, before (the text as saved, to tell if anything changed), goalX, hold, keep, clicks, pending, pendAt, sig }
// The controls that style the letters; a press on them leaves the text being edited
const TE_KEEP = '#fontpick, #tx-style, #tx-bold, #tx-italic, #tx-size, #tx-lh, #tx-ls, #fill-color, #fill-hex, #fill-none, #palette';
const teKeeps = el => !!(el && el.closest && (el.closest(TE_KEEP) || (el.closest('label') && el.closest('label').control && el.closest('label').control.matches(TE_KEEP))));
const teEl = $('#text-edit');
const teObj = () => te && byId(te.id);

/* ---------- the selection: the textarea keeps it, we draw it ---------- */
const teSel = () => ({ a: teEl.selectionStart, b: teEl.selectionEnd });
// Where the selection was started (anchor) and where its moving end, the caret, is (focus)
function teEnds() {
  const s = teSel();
  return teEl.selectionDirection === 'backward' ? { anchor: s.b, focus: s.a } : { anchor: s.a, focus: s.b };
}
function teSetSel(anchor, focus) {
  try { teEl.setSelectionRange(Math.min(anchor, focus), Math.max(anchor, focus), anchor > focus ? 'backward' : anchor < focus ? 'forward' : 'none'); } catch (e) { /* no textarea to hold it */ }
  drawOverlay();
}
// The browser moves the caret after a key is handled (and tells us in more than one way, depending on the browser): redraw once, soon
let teFrame = 0;
function teSoon() {
  if (teFrame) return;
  teFrame = requestAnimationFrame(() => { teFrame = 0; if (te) drawOverlay(); });
}

/* ---------- drawing: the box, the highlight and the caret ---------- */
// Drawn in the text's own box coordinates, inside the transform the outlines use, so it is exact for turned and mirrored text too
function teOverlay() {
  const o = teObj();
  if (!o) return false;
  const lay = textLayout(o), s = teSel(), g = svgEl('g', { transform: objXf(o) });
  g.appendChild(svgEl('rect', { x: 0, y: 0, width: o.w, height: o.h, class: 'ov-line ov-dash' }));
  selectionRects(lay, s.a, s.b).forEach(r => g.appendChild(svgEl('rect', { x: r.x, y: r.y, width: r.w, height: r.h, class: 'te-sel' })));
  const c = caretAt(lay, teEnds().focus);   // (always there, to say where the keyboard is; only shown when nothing is selected and the keyboard is here)
  g.appendChild(svgEl('line', { x1: c.x, y1: c.y0, x2: c.x, y2: c.y1, class: s.a === s.b && document.activeElement === teEl ? 'te-caret' : 'te-caret off' }));
  ov.appendChild(g);
  tePlace();
  if (te.pending && (s.a !== s.b || s.a !== te.pendAt)) te.pending = null;   // a style chosen at the caret is for typing right there
  const sig = JSON.stringify(teStyleShown(o));
  if (sig !== te.sig) { te.sig = sig; updateInspector(); }   // the controls show the letters at the caret
  return true;   // no handles while typing
}
// The invisible textarea follows the caret, so a phone keyboard or an input method's window opens next to it
function tePlace() {
  const caret = te && ov.querySelector('.te-caret');
  if (!caret || !teEl.offsetParent) return;
  const r = caret.getBoundingClientRect(), hr = teEl.offsetParent.getBoundingClientRect(), st = teEl.style;
  st.left = rnd(r.left - hr.left, 1) + 'px';
  st.top = rnd(r.top - hr.top, 1) + 'px';
  st.height = Math.max(rnd(r.height, 1), 8) + 'px';
}

/* ---------- starting and ending ---------- */
function startTextEdit(o, isNew) {
  if (te) finishTextEdit();
  if (!o || o.kind !== 'text') return;
  if (isLocked(o) || isHidden(o)) {   // a locked text can't be typed over: use the Design tab
    if (isNew) commit();
    S.sel = new Set([o.id]); refreshAll(); openPanel(); focusText();
    return;
  }
  S.sel = new Set([o.id]);
  te = { id: o.id, isNew: !!isNew, before: docJSON(o), goalX: null, hold: false, keep: false, clicks: { n: 0, t: 0, x: 0, y: 0 }, pending: null, pendAt: -1, sig: '' };
  teEl.value = o.text; teEl.hidden = false;
  refreshAll();
  setTimeout(() => { if (te && te.id === o.id) { teEl.focus({ preventScroll: true }); teEl.select(); drawOverlay(); } }, 30);   // after the click that started it is over
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
  if (o && (t.isNew || docJSON(o) !== t.before)) commit();   // (changes to the style while editing were not committed one by one)
  refreshAll();
}

/* ---------- the mouse and touch: a press on the text places the caret ---------- */
// Called first by the Select tool while editing. Says whether the press was on the text (anywhere in its box).
function teDown(e, p) {
  const o = teObj();
  if (!o) return false;
  te.hold = false;
  if (e.button > 0 || !boxContains(o, p, TE_PAD / view.z)) { finishTextEdit(); return false; }   // elsewhere it works as usual, after the edit ends
  const q = worldToBox(o, p.x, p.y), at = indexAtPoint(textLayout(o), q[0], q[1]);
  const c = te.clicks, again = e.timeStamp - c.t < 450 && Math.hypot(e.clientX - c.x, e.clientY - c.y) < 6;
  c.n = again ? Math.min(c.n + 1, 3) : 1; c.t = e.timeStamp; c.x = e.clientX; c.y = e.clientY;   // (a fourth quick press stays on the line)
  let anchor = at, focus = at;
  if (c.n === 2) [anchor, focus] = wordRange(o.text, at);
  else if (c.n === 3) [anchor, focus] = lineRange(o.text, at);
  else if (e.shiftKey) anchor = teEnds().anchor;
  te.hold = true; te.goalX = null;
  drag = { type: 'textsel', anchor };
  teSetSel(anchor, focus);
  teEl.focus({ preventScroll: true });
  e.preventDefault();
  return true;
}
DRAGS.textsel = {
  move(p) {
    const o = teObj();
    if (!o) return;
    const q = worldToBox(o, p.x, p.y);
    te.goalX = null;
    teSetSel(drag.anchor, indexAtPoint(textLayout(o), q[0], q[1]));
  },
  end() {
    if (te) { teEl.focus({ preventScroll: true }); setTimeout(() => { if (te) te.hold = false; }, 350); }   // (a phone sends its own mouse events a moment after the touch)
    drawOverlay();
  },
  cancel() { if (te) te.hold = false; },
  overlay: () => !!(te && teOverlay())
};
// While a press on the text is going on the textarea must keep the keyboard, or the edit would end
stage.addEventListener('mousedown', e => { if (te && te.hold) e.preventDefault(); });

/* ---------- the keyboard ---------- */
teEl.addEventListener('input', () => {
  const o = teObj();
  if (!o) return;
  te.goalX = null;
  setTextValue(o, teEl.value, te.pending); te.pending = null;   // (letters typed take the style of their neighbours, or the one chosen at the caret)
  refresh(o);
  render(); renderLayers();
  $('#tx-text').value = o.text;
});
teEl.addEventListener('keydown', e => {
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); e.stopPropagation(); finishTextEdit(); stage.focus({ preventScroll: true }); return; }
  const sk = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (sk === 'b' || sk === 'i')) { e.preventDefault(); e.stopPropagation(); toggleStyle(sk === 'b' ? 'bold' : 'italic', true); return; }   // the one shortcut that works while typing
  e.stopPropagation();   // typing is never a shortcut
  const o = teObj();
  if (!o || !te) return;
  // Up and Down are ours, so they follow the lines as drawn and keep their column across short lines
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
    e.preventDefault();
    const ends = teEnds(), m = verticalMove(textLayout(o), ends.focus, e.key === 'ArrowUp' ? -1 : 1, te.goalX);
    te.goalX = m.goalX;
    teSetSel(e.shiftKey ? ends.anchor : m.index, m.index);
    return;
  }
  // Home and End go to the ends of the line as drawn. The textarea only knows the lines made by line breaks, which is all of them
  // for point text; a text wrapped to a box has more
  if ((e.key === 'Home' || e.key === 'End') && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
    const lay = textLayout(o);
    if (lay.area) {
      e.preventDefault();
      const ends = teEnds(), L = lineOfIndex(lay, ends.focus), at = e.key === 'Home' ? L.start : L.cend;
      te.goalX = null;
      teSetSel(e.shiftKey ? ends.anchor : at, at);
      return;
    }
  }
  if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta') te.goalX = null;   // anything else starts a new column
  teSoon();
});
['keyup', 'select', 'focus'].forEach(n => teEl.addEventListener(n, () => { if (te) teSoon(); }));
teEl.addEventListener('focus', () => { if (te) te.keep = false; });
document.addEventListener('selectionchange', () => { if (te && document.activeElement === teEl) teSoon(); });
teEl.addEventListener('blur', e => {
  // A press on the text itself takes the keyboard back at once; a style control keeps the edit going; anything else ends it
  if (te && te.hold) { setTimeout(() => { if (te && te.hold) teEl.focus({ preventScroll: true }); }, 0); return; }
  if (te && (te.keep || teKeeps(e.relatedTarget))) { teSoon(); return; }
  finishTextEdit();
});
// A press anywhere outside the text, the stage and the style controls ends the edit (the keyboard may be in a control by then, so there may be no blur)
document.addEventListener('pointerdown', e => {
  if (!te) return;
  te.keep = teKeeps(e.target);
  if (!te.keep && !e.target.closest('#stage')) finishTextEdit();
}, true);
// Esc while the keyboard is in a style control
document.addEventListener('keydown', e => {
  if (te && e.key === 'Escape' && document.activeElement !== teEl && !e.defaultPrevented && !(typeof fpIsOpen === 'function' && fpIsOpen())) { finishTextEdit(); stage.focus({ preventScroll: true }); }
});

/* ---------- color, size and font of the selected letters ---------- */
// What the letters at the caret (or the start of the selection) look like, as the controls should show: { color, size, font, spacing, lineHeight }
function teStyleShown(o) {
  const s = teSel(), n = String(o.text).length, st = textStyleAt(o, Math.min(s.a === s.b ? Math.max(s.a - 1, 0) : s.a, Math.max(n - 1, 0))), p = te && te.pending;
  if (p) {
    if ('c' in p) st.color = p.c == null ? o.fill : p.c;
    if ('s' in p) st.size = o.size * (p.s == null ? 1 : p.s);
    if ('f' in p) st.font = p.f == null ? o.font : p.f;
    if ('l' in p) st.spacing = p.l == null ? o.ls || 0 : p.l;
    if ('h' in p) st.lineHeight = p.h == null ? o.lh : p.h;
  }
  return st;
}
// Set { color, size, font, spacing, lineHeight } (any of them) on the selected letters, or at a caret for the letters typed next. False when not editing.
function teStyle(attrs) {
  const o = teObj();
  if (!o) return false;
  const s = teSel();
  if (s.a === s.b) { te.pending = Object.assign(te.pending || {}, runAttrsFor(o, attrs)); te.pendAt = s.a; }
  else { applyTextStyle(o, s.a, s.b, attrs); refresh(o); }
  render(); renderLayers(); drawOverlay(); updateInspector();
  return true;
}
// Back to typing after a button was pressed
function teRefocus() { setTimeout(() => { if (te) teEl.focus({ preventScroll: true }); }, 0); }
// The control was used: while editing the change is saved with the whole edit when it ends, so no separate step now
function settle() { if (te) teRefocus(); else commit(); }
window.addEventListener('resize', () => { if (te) drawOverlay(); });
