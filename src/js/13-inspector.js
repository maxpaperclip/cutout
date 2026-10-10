/* =====================================================================
   Inspector (Design tab)
   ===================================================================== */
const F = { x: $('#f-x'), y: $('#f-y'), w: $('#f-w'), h: $('#f-h'), rot: $('#f-rot'), r: $('#f-r') };
const show = (sel, on) => { $(sel).hidden = !on; };
const setNum = (inp, v) => { if (document.activeElement !== inp) inp.value = rnd(v, 2); };
const HEX = /^#[0-9a-f]{6}$/i;
function toHex6(c) {
  if (HEX.test(c)) return c.toLowerCase();
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c || '');
  return m ? ('#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toLowerCase() : '#000000';
}
function updateInspector() {
  const sel = selObjs(), o = one(), n = sel.length;
  show('#sec-geom', !!o);
  show('#sec-text', !!o && o.kind === 'text');
  show('#sec-poly', !!o && o.kind === 'polygon');
  show('#sec-app', n > 0);
  show('#sec-erase', !!o && canErase(o));
  $('#btn-erase-reset').disabled = !(o && o.erase);
  if (o && canErase(o)) $('#erase-help').textContent = o.paint ? 'Rub out paint with the Eraser. Undo brings it back.' : 'Erasing only hides parts of the photo, so nothing is lost. Hold Alt while erasing to bring parts back.';
  const nPhotoSel = sel.filter(hasPixels).length;
  show('#sec-mask', nPhotoSel > 0 || (!!o && hasPic(o)) || (n > 0 && doc.objects.some(hasPixels)));
  show('#sec-combine', !(n === 1 && nPhotoSel === 1));
  show('#sec-arrange', n > 0);
  $('#empty-hint').hidden = n > 0;
  $$('[data-bool]').forEach(b => { b.disabled = n < 2; });
  const units = n ? selectionUnits(doc, S.sel) : [];
  $('#btn-group').disabled = units.length < 2;
  $('#btn-ungroup').disabled = !units.some(u => u.g);
  $('#btn-flatten').disabled = !(o && kindInfo(o).plain);
  $('#btn-breakapart').disabled = !(o && o.kind === 'text' && !isLocked(o));
  $('#btn-points').disabled = !(o && (o.kind === 'path' || kindInfo(o).plain) && !isLocked(o));
  // photo mask controls
  const nPhoto = sel.filter(hasPixels).length, nShape = n - nPhoto;
  $('#btn-mask').disabled = !(nPhoto === 1 && nShape >= 1);
  const masked = o && hasPic(o) ? o : null;
  $('#mask-controls').hidden = !masked;
  $('#mask-help').textContent = masked ? 'The photo is part of this shape. Move and zoom it here, or release it to get the photo back as its own object.'
    : nPhoto === 1 && nShape === 0 ? 'Now Shift-click the shape or text you want to use as the mask.'
    : nPhoto === 1 ? 'Ready. The selected shapes become one mask, and the photo shows through them.'
    : 'Select a photo, then Shift-click the shape or text that should cut it out.';
  if (masked) {
    const rec = images.get(masked.pic.id);
    setNum($('#mk-x'), masked.pic.dx); setNum($('#mk-y'), masked.pic.dy);
    const z = masked.pic.s / coverScale(masked, rec) * 100;
    setNum($('#mk-zoom'), z); if (document.activeElement !== $('#mk-zoom-r')) $('#mk-zoom-r').value = clamp(z, 25, 400);
  }
  $('#btn-panel').setAttribute('aria-pressed', $('#panel').classList.contains('open') ? 'true' : 'false');
  if (o) {
    const ends = lineEnds(o);   // a straight line shows its two ends instead of a box
    $('#lb-x').textContent = ends ? 'X1' : 'X'; $('#lb-y').textContent = ends ? 'Y1' : 'Y';
    $('#lb-w').textContent = ends ? 'X2' : 'W'; $('#lb-h').textContent = ends ? 'Y2' : 'H';
    $('#wrap-rot').hidden = !!ends;
    $('#wrap-r').hidden = o.kind !== 'rect';
    setNum(F.x, ends ? ends[0][0] : o.x); setNum(F.y, ends ? ends[0][1] : o.y);
    setNum(F.w, ends ? ends[1][0] : o.w); setNum(F.h, ends ? ends[1][1] : o.h);
    setNum(F.rot, o.rot);
    if (o.kind === 'rect') setNum(F.r, o.r || 0);
    if (o.kind === 'text') {
      const ta = $('#tx-text'); if (document.activeElement !== ta && ta.value !== o.text) ta.value = o.text;
      const ts = te && te.id === o.id ? teStyleShown(o) : null;   // while typing in place: the letters at the caret
      fpSetValue(ts ? (fonts[ts.font] ? ts.font : DEFAULT_FONT) : fonts[o.font] ? o.font : DEFAULT_FONT);
      const miss = missingGlyphs(o), mh = $('#tx-missing');   // letters the font does not have would draw as nothing
      mh.hidden = !miss.length;
      if (miss.length) mh.textContent = 'This font has no letters for ' + miss.slice(0, 6).join(' ') + (miss.length > 6 ? ' \u2026' : '') + '. Try a font under International.';
      setNum($('#tx-size'), ts ? ts.size : o.size); setNum($('#tx-lh'), ts ? ts.lineHeight : o.lh); setNum($('#tx-ls'), (ts ? ts.spacing : o.ls || 0) * 100);
      $$('[data-align]').forEach(b => b.setAttribute('aria-pressed', b.dataset.align === o.align ? 'true' : 'false'));
      $('#tx-fixed').checked = o.bw > 0; $('#tx-hang').checked = !!o.hang; $('#tx-hyph').checked = !!o.hyph;
      $('#tx-hyph').disabled = !(o.bw > 0);   // (a word is only broken to fit a width)
    }
    if (o.kind === 'polygon') {
      setNum($('#pg-sides'), o.sides); $('#pg-star').checked = !!o.star;
      $('#pg-inner').value = Math.round((o.inner || 0.45) * 100); $('#wrap-inner').hidden = !o.star;
    }
  }
  if (n) {
    const a = sel.find(hasPaint) || sel[0], onlyLines = sel.every(isStraightLine), onlyPhotos = sel.every(hasPixels);
    const typing = o && o.kind === 'text' && te && te.id === o.id ? teStyleShown(o) : null;   // (letters can take a color of their own, over a gradient too)
    const noFill = onlyLines || onlyPhotos, g = hasGrad(a) && !typing ? a.grad : null;
    $('#row-filltype').hidden = noFill; $('#row-fill').hidden = noFill || !!g; $('#palette').hidden = noFill || !!g;
    $('#grad-controls').hidden = noFill || !g;
    $$('#fill-type button').forEach(b => b.setAttribute('aria-pressed', b.dataset.ft === (g ? g.type : 'solid') ? 'true' : 'false'));
    if (g) {
      renderGradEditor(g);
      const lin = g.type === 'linear';
      $('#lb-grad-angle').textContent = lin ? 'Angle' : ''; $('#grad-angle').hidden = !lin;
      if (lin) setNum($('#grad-angle'), Math.round(gradAngle(a)));
    }
    ['#row-stroke', '#row-weight', '#row-corners', '#row-ends'].forEach(s => { $(s).hidden = onlyPhotos; });
    const fill = (typing ? typing.color : a.fill) && (typing ? typing.color : a.fill) !== 'none' ? (typing ? typing.color : a.fill) : null, stroke = a.stroke && a.stroke !== 'none' ? a.stroke : null;
    if (document.activeElement !== $('#fill-hex')) $('#fill-hex').value = fill ? toHex6(fill) : '';
    $('#fill-color').value = fill ? toHex6(fill) : '#cccccc';
    $('#fill-none').setAttribute('aria-pressed', fill ? 'false' : 'true');
    if (document.activeElement !== $('#stroke-hex')) $('#stroke-hex').value = stroke ? toHex6(stroke) : '';
    $('#stroke-color').value = stroke ? toHex6(stroke) : '#151936';
    $('#stroke-none').setAttribute('aria-pressed', stroke ? 'false' : 'true');
    setNum($('#stroke-w'), a.sw != null ? a.sw : 0);
    $('#stroke-dash').value = a.dash || 'solid'; $('#stroke-join').value = a.join || 'miter';
    $('#stroke-cap').value = CAPS.indexOf(a.cap) >= 0 ? a.cap : '';
    $('#blend').value = blendOf(a) || 'normal';
    $('#opacity').value = Math.round(a.opacity * 100); $('#opacity-out').textContent = Math.round(a.opacity * 100) + '%';
  }
}

function showColor(prefix, c) {
  const h = $(prefix + '-hex');
  if (document.activeElement !== h) h.value = toHex6(c);
  $(prefix + '-color').value = toHex6(c);
}
function cssRgba(hex, a) {
  const n = parseInt(toHex6(hex).slice(1), 16);
  return a < 1 ? 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + rnd(a, 3) + ')' : toHex6(hex);
}

function forSel(fn) { selObjs().forEach(fn); }
function rememberStyle(o) {
  if (!o) return;
  const line = isStraightLine(o);
  if (!line && o.kind !== 'text') { S.style.fill = o.fill; S.style.grad = hasGrad(o) ? cloneGrad(o.grad) : null; }
  S.style.stroke = o.stroke === 'none' && line ? S.style.stroke : o.stroke;
  S.style.sw = o.sw || S.style.sw; S.style.join = o.join; S.style.dash = o.dash;
}
// Choosing a plain fill color (or None) turns a gradient fill back into a solid one
function styleSet(k, v) {
  if (k === 'fill' && te && teStyle({ color: v })) return;   // typing in place: only the selected letters (or the next ones typed)
  forSel(o => {
    if (hasPixels(o) && k !== 'opacity') return;
    o[k] = v;
    if (k === 'fill') { delete o.grad; if (o.kind === 'text' && o.runs) { applyWholeStyle(o, { color: v }); refresh(o); } }   // (the whole text, so no letter keeps a color of its own)
  });
  rememberStyle(selObjs().find(hasPaint)); render();
}

// Geometry fields
function onNum(inp, fn, resizes) {
  inp.addEventListener('change', () => {
    const v = parseFloat(inp.value), o = one();
    if (!o || !isFinite(v)) { updateInspector(); return; }
    const ow = o.w, oh = o.h, p0 = o.pic ? Object.assign({}, o.pic) : null;
    if (fn(o, v) === 'live') { refresh(o); render(); renderLayers(); updateInspector(); return; }   // (a change while typing in place is saved when the edit ends)
    refresh(o);
    if (resizes && p0 && ow > 0 && oh > 0 && (o.w !== ow || o.h !== oh)) rescalePic(o, p0, o.w / ow, o.h / oh);
    commit();
  });
}
// For a straight line the four fields are its ends: X1, Y1 (end 0) and X2, Y2 (end 1)
function setLineField(o, end, axis, v) {
  const e = lineEnds(o); if (!e) return false;
  const a = { x: e[0][0], y: e[0][1] }, b = { x: e[1][0], y: e[1][1] };
  (end ? b : a)[axis] = v;
  setLineEnds(o, a, b);
  return true;
}
onNum(F.x, (o, v) => { if (!setLineField(o, 0, 'x', v)) o.x = v; });
onNum(F.y, (o, v) => { if (!setLineField(o, 0, 'y', v)) o.y = v; });
onNum(F.w, (o, v) => {
  if (setLineField(o, 1, 'x', v)) return;
  else if (o.kind === 'text') { if (o.bw > 0) o.bw = Math.max(v, 1); else o.size = Math.max(4, o.size * Math.max(v, 1) / o.w); }   // (a box gets wider; the words wrap again)
  else if (keepsRatio(o)) { const k = Math.max(v, 1) / o.w; o.w *= k; o.h *= k; }
  else o.w = Math.max(v, 1);
}, true);
onNum(F.h, (o, v) => {
  if (setLineField(o, 1, 'y', v)) return;
  else if (o.kind === 'text') { const s0 = o.size; o.size = Math.max(4, o.size * Math.max(v, 1) / o.h); if (o.bw > 0) o.bw = Math.max(o.bw * o.size / s0, 1); }   // (a box scales with its letters)
  else if (keepsRatio(o)) { const k = Math.max(v, 1) / o.h; o.w *= k; o.h *= k; }
  else o.h = Math.max(v, 1);
}, true);
onNum(F.rot, (o, v) => { o.rot = rnd(normDeg(v), 2); });
onNum(F.r, (o, v) => { o.r = clamp(v, 0, Math.min(o.w, o.h) / 2); });

// Text
const txArea = $('#tx-text');
txArea.addEventListener('input', () => { const o = one(); if (!o || o.kind !== 'text') return; setTextValue(o, txArea.value); refresh(o); render(); renderLayers(); });
txArea.addEventListener('change', () => commit());
txArea.addEventListener('keydown', e => { if (e.key === 'Escape') txArea.blur(); });
onNum($('#tx-size'), (o, v) => {
  if (o.kind !== 'text') return;
  if (te && te.id === o.id && teStyle({ size: clamp(v, 4, 1200) })) { teRefocus(); return 'live'; }   // the selected letters
  o.size = clamp(v, 4, 1200);   // the whole text, every letter in proportion
}, true);
// Line height and letter spacing: while typing in place, for the selected letters (the tallest letter sets a line's height); otherwise the whole text
onNum($('#tx-lh'), (o, v) => {
  if (o.kind !== 'text') return;
  if (te && te.id === o.id && teStyle({ lineHeight: v })) { teRefocus(); return 'live'; }
  applyWholeStyle(o, { lineHeight: v });
});
onNum($('#tx-ls'), (o, v) => {
  if (o.kind !== 'text') return;
  if (te && te.id === o.id && teStyle({ spacing: clamp(v, -20, 200) / 100 })) { teRefocus(); return 'live'; }
  applyWholeStyle(o, { spacing: clamp(v, -20, 200) / 100 });
});
// A text with no fixed width is as wide as its longest line; this pins it to the width it has now, so it can wrap and justify
function fixTextWidth(o) { if (!(o.bw > 0)) o.bw = Math.max(rnd(o.w, 2), o.size); }
$$('[data-align]').forEach(b => b.addEventListener('click', () => {
  const o = one(); if (!o || o.kind !== 'text') return;
  o.align = b.dataset.align;
  if (o.align === 'justify') fixTextWidth(o);   // (justified text fills a width, so it needs one)
  refresh(o); commit();
}));
$('#tx-fixed').addEventListener('change', e => {
  const o = one(); if (!o || o.kind !== 'text') return;
  if (e.target.checked) fixTextWidth(o); else { delete o.bw; if (o.align === 'justify') o.align = 'left'; }
  refresh(o); commit();
});
$('#tx-hang').addEventListener('change', e => { const o = one(); if (!o || o.kind !== 'text') return; if (e.target.checked) o.hang = true; else delete o.hang; refresh(o); commit(); });
$('#tx-hyph').addEventListener('change', e => { const o = one(); if (!o || o.kind !== 'text') return; if (e.target.checked) o.hyph = true; else delete o.hyph; refresh(o); commit(); });
$('#tx-addfont').addEventListener('click', () => $('#file-font').click());
$('#file-font').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const r = await addUserFont(f);
    const o = one();
    if (o && o.kind === 'text') { o.font = r.key; refresh(o); commit(); }
    FP.cat = 'user'; if (fpIsOpen()) { fpTabsRender(); fpRender(); }
    toast('Added \u201c' + r.fam + '\u201d.' + (r.kept ? '' : ' It could not be kept for next time.'));
  } catch (err) {
    toast('That font file could not be read. Use a .ttf, .otf or .woff file (not .woff2).');
  }
});

// Polygon
onNum($('#pg-sides'), (o, v) => { if (o.kind === 'polygon') o.sides = clamp(Math.round(v), 3, 24); });
$('#pg-star').addEventListener('change', e => { const o = one(); if (!o || o.kind !== 'polygon') return; o.star = e.target.checked; refresh(o); commit(); });
$('#pg-inner').addEventListener('input', e => { const o = one(); if (!o || o.kind !== 'polygon') return; o.inner = e.target.value / 100; refresh(o); render(); });
$('#pg-inner').addEventListener('change', () => commit());

// Appearance
function wireColor(colorId, hexId, noneId, key, fallback) {
  const c = $(colorId), h = $(hexId), n = $(noneId);
  c.addEventListener('input', () => { styleSet(key, c.value); });
  c.addEventListener('change', () => { if (!te) commit(); });
  h.addEventListener('change', () => { const v = h.value.trim(); if (HEX.test(v)) { styleSet(key, v.toLowerCase()); settle(); } else updateInspector(); });
  h.addEventListener('keydown', e => { if (e.key === 'Enter') h.blur(); });
  n.addEventListener('click', () => {
    const a = selObjs()[0]; if (!a) return;
    const cur = key === 'fill' && te && teObj() ? teStyleShown(teObj()).color : a[key];   // (while typing: the letters at the caret)
    styleSet(key, cur && cur !== 'none' ? 'none' : fallback); settle();
  });
}
wireColor('#fill-color', '#fill-hex', '#fill-none', 'fill', '#3b3bf5');

// Gradient fills. Gradient edits apply to every selected shape that has a gradient.
const gradTargets = () => selObjs().filter(hasGrad);
// The shape whose gradient the editor shows (the same one the rest of Appearance shows)
const gradPrimary = () => { const a = selObjs().find(hasPaint); return a && hasGrad(a) ? a : null; };

/* ---------- gradient color editor ----------
   A bar showing the gradient, with a marker under it for each color. Click the bar to add a color,
   drag a marker to move one, and use the Color and Opacity rows to change the selected one.
   With several shapes selected, editing the colors gives them all the same colors; each keeps its
   own direction. gSel is the selected marker's index; it lives here, not in the drawing. */
let gSel = 0;
const gStopsBox = $('#grad-stops'), gBar = $('#grad-bar');
function renderGradEditor(g) {
  const n = g.stops.length;
  gSel = clamp(gSel, 0, n - 1);
  $('#grad-fill').style.background = 'linear-gradient(90deg,' + g.stops.map(st => cssRgba(st.c, st.a) + ' ' + rnd(st.at * 100, 2) + '%').join(',') + ')';
  gBar.classList.toggle('full', n >= GRAD_MAX_STOPS);
  gBar.title = n >= GRAD_MAX_STOPS ? 'A gradient can have up to ' + GRAD_MAX_STOPS + ' colors' : 'Click to add a color here';
  // Reuse the marker buttons so a marker being dragged keeps hold of the pointer
  while (gStopsBox.children.length < n) gStopsBox.appendChild(makeStopButton());
  while (gStopsBox.children.length > n) gStopsBox.lastChild.remove();
  g.stops.forEach((st, i) => {
    const b = gStopsBox.children[i];
    b.dataset.i = i;
    b.style.left = rnd(st.at * 100, 3) + '%';
    b.style.setProperty('--c', cssRgba(st.c, st.a));
    b.setAttribute('aria-pressed', i === gSel ? 'true' : 'false');
    b.setAttribute('aria-label', 'Color ' + (i + 1) + ' of ' + n + ', ' + toHex6(st.c) + ', at ' + Math.round(st.at * 100) + '%' + (st.a < 1 ? ', ' + Math.round(st.a * 100) + '% opacity' : ''));
    b.tabIndex = i === gSel ? 0 : -1;
  });
  const cur = g.stops[gSel];
  showColor('#gs', cur.c);
  if (document.activeElement !== $('#gs-alpha')) $('#gs-alpha').value = Math.round(cur.a * 100);
  $('#gs-alpha-out').textContent = Math.round(cur.a * 100) + '%';
  $('#gs-remove').disabled = n <= GRAD_MIN_STOPS;
}
// Change the shown gradient with fn(grad) -> index to select, then copy its colors to the other selected gradient shapes
function editStops(fn) {
  const a = gradPrimary(); if (!a) return false;
  const i = fn(a.grad);
  if (i < 0) return false;
  gSel = i;
  gradTargets().forEach(o => { if (o !== a) o.grad.stops = cloneGrad(a.grad).stops; syncGradFill(o); });
  rememberStyle(a);
  return true;
}
const barPos = x => { const r = gBar.getBoundingClientRect(); return r.width ? (x - r.left) / r.width : 0; };
// Drag the selected marker with the pointer until it is let go; one undo step for the whole drag
function dragStop(e, target, added) {
  target.setPointerCapture(e.pointerId);
  const x0 = e.clientX;
  let moved = false;
  const move = ev => {
    if (!moved && Math.abs(ev.clientX - x0) < 3) return;
    moved = true;
    const at = barPos(ev.clientX);
    if (editStops(g => moveGradStop(g, gSel, at))) render();
  };
  const up = () => {
    target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up);
    if (moved || added) commit(); else render();
    const b = gStopsBox.children[gSel]; if (b) b.focus({ preventScroll: true });
  };
  target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
}
function makeStopButton() {
  const b = elt('button', 'gstop'); b.appendChild(elt('i'));
  b.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    e.preventDefault(); e.stopPropagation();
    gSel = +b.dataset.i; render();
    dragStop(e, b, false);
  });
  // Keyboard focus selects the marker, so the arrow keys and Delete act on the one that has focus
  b.addEventListener('focus', () => { const i = +b.dataset.i; if (i !== gSel) { gSel = i; render(); } });
  b.addEventListener('keydown', e => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation();
      const a = gradPrimary(); if (!a) return;
      const step = (e.shiftKey ? 0.1 : 0.01) * (k === 'ArrowLeft' ? -1 : 1);
      if (editStops(g => moveGradStop(g, gSel, g.stops[gSel].at + step))) { commit(); gStopsBox.children[gSel].focus(); }
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      // Move between markers, like a toolbar
      e.preventDefault(); e.stopPropagation();
      const n = gStopsBox.children.length;
      gSel = clamp(gSel + (k === 'ArrowUp' ? -1 : 1), 0, n - 1); render(); gStopsBox.children[gSel].focus();
    } else if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault(); e.stopPropagation();   // don't delete the whole shape
      removeSelectedStop();
      const nb = gStopsBox.children[gSel]; if (nb) nb.focus();
    }
  });
  return b;
}
gBar.addEventListener('pointerdown', e => {
  if (e.button > 0) return;
  e.preventDefault();
  const at = barPos(e.clientX);
  const a = gradPrimary(); if (!a) return;
  if (a.grad.stops.length >= GRAD_MAX_STOPS) { toast('A gradient can have up to ' + GRAD_MAX_STOPS + ' colors. Remove one to add another.'); return; }
  if (!editStops(g => addGradStop(g, at))) return;
  render();
  dragStop(e, gBar, true);   // keep dragging to place the new color
});
function removeSelectedStop() {
  if (editStops(g => removeGradStop(g, gSel))) commit();
  else toast('A gradient needs at least two colors. Choose Solid for a single color.');
}
$('#gs-remove').addEventListener('click', removeSelectedStop);
(function wireStopColor() {
  const c = $('#gs-color'), h = $('#gs-hex'), al = $('#gs-alpha');
  const setColor = v => editStops(g => { g.stops[gSel].c = v; return gSel; });
  c.addEventListener('input', () => { if (setColor(c.value.toLowerCase())) render(); });
  c.addEventListener('change', () => commit());
  h.addEventListener('change', () => { const v = normHex(h.value.trim()); if (v && setColor(v)) commit(); else updateInspector(); });
  h.addEventListener('keydown', e => { if (e.key === 'Enter') h.blur(); });
  al.addEventListener('input', () => { if (editStops(g => { g.stops[gSel].a = clamp(al.value / 100, 0, 1); return gSel; })) render(); });
  al.addEventListener('change', () => commit());
})();
// Arrow keys on a slider move the slider, not the selected shape
['#gs-alpha', '#opacity'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key.startsWith('Arrow')) e.stopPropagation(); }));
function setFillType(ft) {
  const list = selObjs().filter(o => hasPaint(o) && !isStraightLine(o));
  if (!list.length) return;
  list.forEach(o => {
    if (ft === 'solid') { delete o.grad; return; }   // o.fill already holds the first gradient color
    if (hasGrad(o)) {
      if (o.grad.type === ft) return;
      const stops = o.grad.stops; o.grad = makeGrad(ft); o.grad.stops = stops;   // same colors, new shape
    } else o.grad = makeGrad(ft, o.fill !== 'none' ? o.fill : null);
    syncGradFill(o);
  });
  rememberStyle(list[0]); commit();
}
$$('#fill-type button').forEach(b => b.addEventListener('click', () => setFillType(b.dataset.ft)));
$('#grad-angle').addEventListener('change', e => {
  const v = parseFloat(e.target.value), list = gradTargets().filter(o => o.grad.type === 'linear');
  if (!isFinite(v) || !list.length) { updateInspector(); return; }
  list.forEach(o => setGradAngle(o, normDeg(v)));
  rememberStyle(list[0]); commit();
});
$('#grad-reverse').addEventListener('click', () => {
  const list = gradTargets(); if (!list.length) return;
  list.forEach(o => { reverseGrad(o.grad); syncGradFill(o); });
  const a = gradPrimary(); if (a) gSel = a.grad.stops.length - 1 - gSel;   // keep the same color selected
  rememberStyle(list[0]); commit();
});
wireColor('#stroke-color', '#stroke-hex', '#stroke-none', 'stroke', '#151936');
$('#stroke-w').addEventListener('change', e => { const v = parseFloat(e.target.value); if (!isFinite(v)) return updateInspector(); styleSet('sw', clamp(v, 0, 300)); commit(); });
$('#stroke-dash').addEventListener('change', e => { styleSet('dash', e.target.value); commit(); });
$('#stroke-join').addEventListener('change', e => { styleSet('join', e.target.value); commit(); });
// Line ends: Automatic is stored as no setting at all, so older drawings look exactly as before
$('#stroke-cap').addEventListener('change', e => {
  const v = e.target.value;
  forSel(o => { if (!hasPaint(o)) return; if (v) o.cap = v; else delete o.cap; });
  commit();
});
// Blend mode (photos too); Normal is stored as no setting
(function blendSelect() {
  const sel = $('#blend');
  BLENDS.forEach(([id, label]) => { const op = elt('option', '', label); op.value = id; sel.appendChild(op); });
  sel.addEventListener('change', () => {
    const v = sel.value;
    forSel(o => { if (v === 'normal') delete o.blend; else o.blend = v; });
    commit();
  });
})();
$('#opacity').addEventListener('input', e => { styleSet('opacity', e.target.value / 100); });
$('#opacity').addEventListener('change', () => commit());
(function palette() {
  const cols = ['#151936', '#ffffff', '#3b3bf5', '#00a6a6', '#22b573', '#ffd23f', '#ff9f1c', '#ff5a4f', '#ec3f8c', '#8a4fff', '#8c92ad', '#dfe3f3'];
  const box = $('#palette');
  cols.forEach(c => {
    const b = elt('button', 'sw'); b.style.background = c; b.title = c + '. Click to fill, Shift-click to outline.'; b.setAttribute('aria-label', 'Color ' + c);
    b.addEventListener('click', e => { if (!S.sel.size) return; styleSet(e.shiftKey ? 'stroke' : 'fill', c); settle(); });
    box.appendChild(b);
  });
})();

// Combine + arrange
$$('[data-bool]').forEach(b => b.addEventListener('click', () => runBoolean(b.dataset.bool)));
$('#btn-flatten').addEventListener('click', flattenSelected);
$('#btn-breakapart').addEventListener('click', breakApartSelected);
$('#btn-points').addEventListener('click', () => enterPointEdit(one()));
$('#btn-mask').addEventListener('click', useAsMask);
$('#btn-fit').addEventListener('click', fitPhoto);
$('#btn-release').addEventListener('click', releaseMask);
function maskField(inp, apply) {
  inp.addEventListener('change', () => {
    const v = parseFloat(inp.value), o = one();
    if (!o || !hasPic(o) || !isFinite(v)) { updateInspector(); return; }
    apply(o, v); commit();
  });
}
maskField($('#mk-x'), (o, v) => { o.pic.dx = clamp(v, -1e5, 1e5); });
maskField($('#mk-y'), (o, v) => { o.pic.dy = clamp(v, -1e5, 1e5); });
const setZoom = (o, pct) => { o.pic.s = coverScale(o, images.get(o.pic.id)) * clamp(pct, 10, 2000) / 100; };
maskField($('#mk-zoom'), setZoom);
$('#mk-zoom-r').addEventListener('input', e => { const o = one(); if (o && hasPic(o)) { setZoom(o, parseFloat(e.target.value)); render(); } });
$('#mk-zoom-r').addEventListener('change', () => commit());
$$('[data-align-to]').forEach(b => b.addEventListener('click', () => alignSelected(b.dataset.alignTo)));
$$('[data-order]').forEach(b => b.addEventListener('click', () => orderSelected(b.dataset.order)));
$('#btn-flip-h').addEventListener('click', () => mirrorSelected('h'));
$('#btn-flip-v').addEventListener('click', () => mirrorSelected('v'));
$('#btn-dup').addEventListener('click', duplicateSelected);
$('#btn-group').addEventListener('click', groupSelected);
$('#btn-ungroup').addEventListener('click', ungroupSelected);
$('#btn-del').addEventListener('click', deleteSelected);

