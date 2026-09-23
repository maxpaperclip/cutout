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
  const nPhotoSel = sel.filter(x => x.kind === 'image').length;
  show('#sec-mask', nPhotoSel > 0 || (!!o && hasPic(o)) || (n > 0 && doc.objects.some(x => x.kind === 'image')));
  show('#sec-combine', !(n === 1 && nPhotoSel === 1));
  show('#sec-arrange', n > 0);
  $('#empty-hint').hidden = n > 0;
  $$('[data-bool]').forEach(b => { b.disabled = n < 2; });
  $('#btn-flatten').disabled = !(o && o.kind !== 'path' && o.kind !== 'line' && o.kind !== 'image');
  // photo mask controls
  const nPhoto = sel.filter(x => x.kind === 'image').length, nShape = n - nPhoto;
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
    const line = o.kind === 'line';
    $('#lb-x').textContent = line ? 'X1' : 'X'; $('#lb-y').textContent = line ? 'Y1' : 'Y';
    $('#lb-w').textContent = line ? 'X2' : 'W'; $('#lb-h').textContent = line ? 'Y2' : 'H';
    $('#wrap-rot').hidden = line;
    $('#wrap-r').hidden = o.kind !== 'rect';
    setNum(F.x, line ? o.x1 : o.x); setNum(F.y, line ? o.y1 : o.y);
    setNum(F.w, line ? o.x2 : o.w); setNum(F.h, line ? o.y2 : o.h);
    setNum(F.rot, o.rot);
    if (o.kind === 'rect') setNum(F.r, o.r || 0);
    if (o.kind === 'text') {
      const ta = $('#tx-text'); if (document.activeElement !== ta && ta.value !== o.text) ta.value = o.text;
      $('#tx-font').value = fonts[o.font] ? o.font : DEFAULT_FONT;
      setNum($('#tx-size'), o.size); setNum($('#tx-lh'), o.lh); setNum($('#tx-ls'), (o.ls || 0) * 100);
      $$('[data-align]').forEach(b => b.setAttribute('aria-pressed', b.dataset.align === o.align ? 'true' : 'false'));
    }
    if (o.kind === 'polygon') {
      setNum($('#pg-sides'), o.sides); $('#pg-star').checked = !!o.star;
      $('#pg-inner').value = Math.round((o.inner || 0.45) * 100); $('#wrap-inner').hidden = !o.star;
    }
  }
  if (n) {
    const a = sel.find(x => x.kind !== 'image') || sel[0], onlyLines = sel.every(x => x.kind === 'line'), onlyPhotos = sel.every(x => x.kind === 'image');
    const noFill = onlyLines || onlyPhotos, g = hasGrad(a) ? a.grad : null;
    $('#row-filltype').hidden = noFill; $('#row-fill').hidden = noFill || !!g; $('#palette').hidden = noFill || !!g;
    $('#grad-controls').hidden = noFill || !g;
    $$('#fill-type button').forEach(b => b.setAttribute('aria-pressed', b.dataset.ft === (g ? g.type : 'solid') ? 'true' : 'false'));
    if (g) {
      showColor('#gs-from', g.stops[0].c); showColor('#gs-to', g.stops[g.stops.length - 1].c);
      $('#grad-bar').style.background = 'linear-gradient(90deg,' + g.stops.map(st => cssRgba(st.c, st.a) + ' ' + rnd(st.at * 100, 2) + '%').join(',') + ')';
      const lin = g.type === 'linear';
      $('#lb-grad-angle').textContent = lin ? 'Angle' : ''; $('#grad-angle').hidden = !lin;
      if (lin) setNum($('#grad-angle'), Math.round(gradAngle(a)));
    }
    ['#row-stroke', '#row-weight', '#row-corners'].forEach(s => { $(s).hidden = onlyPhotos; });
    const fill = a.fill && a.fill !== 'none' ? a.fill : null, stroke = a.stroke && a.stroke !== 'none' ? a.stroke : null;
    if (document.activeElement !== $('#fill-hex')) $('#fill-hex').value = fill ? toHex6(fill) : '';
    $('#fill-color').value = fill ? toHex6(fill) : '#cccccc';
    $('#fill-none').setAttribute('aria-pressed', fill ? 'false' : 'true');
    if (document.activeElement !== $('#stroke-hex')) $('#stroke-hex').value = stroke ? toHex6(stroke) : '';
    $('#stroke-color').value = stroke ? toHex6(stroke) : '#151936';
    $('#stroke-none').setAttribute('aria-pressed', stroke ? 'false' : 'true');
    setNum($('#stroke-w'), a.sw != null ? a.sw : 0);
    $('#stroke-dash').value = a.dash || 'solid'; $('#stroke-join').value = a.join || 'miter';
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
  if (o.kind !== 'line' && o.kind !== 'text') { S.style.fill = o.fill; S.style.grad = hasGrad(o) ? cloneGrad(o.grad) : null; }
  S.style.stroke = o.stroke === 'none' && o.kind === 'line' ? S.style.stroke : o.stroke;
  S.style.sw = o.sw || S.style.sw; S.style.join = o.join; S.style.dash = o.dash;
}
// Choosing a plain fill color (or None) turns a gradient fill back into a solid one
function styleSet(k, v) { forSel(o => { if (o.kind === 'image' && k !== 'opacity') return; o[k] = v; if (k === 'fill') delete o.grad; }); rememberStyle(selObjs().find(o => o.kind !== 'image')); render(); }

// Geometry fields
function onNum(inp, fn, resizes) {
  inp.addEventListener('change', () => {
    const v = parseFloat(inp.value), o = one();
    if (!o || !isFinite(v)) { updateInspector(); return; }
    const ow = o.w, oh = o.h, p0 = o.pic ? Object.assign({}, o.pic) : null;
    fn(o, v); refresh(o);
    if (resizes && p0 && ow > 0 && oh > 0 && (o.w !== ow || o.h !== oh)) rescalePic(o, p0, o.w / ow, o.h / oh);
    commit();
  });
}
onNum(F.x, (o, v) => { if (o.kind === 'line') { o.x1 = v; } else o.x = v; });
onNum(F.y, (o, v) => { if (o.kind === 'line') { o.y1 = v; } else o.y = v; });
onNum(F.w, (o, v) => {
  if (o.kind === 'line') o.x2 = v;
  else if (o.kind === 'text') { o.size = Math.max(4, o.size * Math.max(v, 1) / o.w); }
  else if (o.kind === 'image') { const k = Math.max(v, 1) / o.w; o.w *= k; o.h *= k; }
  else o.w = Math.max(v, 1);
}, true);
onNum(F.h, (o, v) => {
  if (o.kind === 'line') o.y2 = v;
  else if (o.kind === 'text') { o.size = Math.max(4, o.size * Math.max(v, 1) / o.h); }
  else if (o.kind === 'image') { const k = Math.max(v, 1) / o.h; o.w *= k; o.h *= k; }
  else o.h = Math.max(v, 1);
}, true);
onNum(F.rot, (o, v) => { o.rot = rnd(normDeg(v), 2); });
onNum(F.r, (o, v) => { o.r = clamp(v, 0, Math.min(o.w, o.h) / 2); });

// Text
const txArea = $('#tx-text');
txArea.addEventListener('input', () => { const o = one(); if (!o || o.kind !== 'text') return; o.text = txArea.value; refresh(o); render(); renderLayers(); });
txArea.addEventListener('change', () => commit());
txArea.addEventListener('keydown', e => { if (e.key === 'Escape') txArea.blur(); });
$('#tx-font').addEventListener('change', e => { const o = one(); if (!o || o.kind !== 'text') return; o.font = e.target.value; refresh(o); commit(); });
onNum($('#tx-size'), (o, v) => { if (o.kind === 'text') o.size = clamp(v, 4, 1200); }, true);
onNum($('#tx-lh'), (o, v) => { if (o.kind === 'text') o.lh = clamp(v, 0.6, 3); });
onNum($('#tx-ls'), (o, v) => { if (o.kind === 'text') o.ls = clamp(v, -20, 200) / 100; });
$$('[data-align]').forEach(b => b.addEventListener('click', () => { const o = one(); if (!o || o.kind !== 'text') return; o.align = b.dataset.align; refresh(o); commit(); }));
function fillFontSelect() {
  const sel = $('#tx-font'); sel.textContent = '';
  Object.keys(fonts).forEach(k => { const op = elt('option', '', fonts[k].label); op.value = k; sel.appendChild(op); });
}
$('#tx-addfont').addEventListener('click', () => $('#file-font').click());
$('#file-font').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const font = opentype.parse(await f.arrayBuffer());
    const fam = (font.names && font.names.fontFamily && (font.names.fontFamily.en || Object.values(font.names.fontFamily)[0])) || f.name.replace(/\.[^.]+$/, '');
    const key = 'user:' + fam + ':' + Date.now();
    fonts[key] = { label: fam + ' (yours)', font };
    fillFontSelect();
    const o = one();
    if (o && o.kind === 'text') { o.font = key; refresh(o); commit(); }
    toast('Added \u201c' + fam + '\u201d.');
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
  c.addEventListener('change', () => commit());
  h.addEventListener('change', () => { const v = h.value.trim(); if (HEX.test(v)) { styleSet(key, v.toLowerCase()); commit(); } else updateInspector(); });
  h.addEventListener('keydown', e => { if (e.key === 'Enter') h.blur(); });
  n.addEventListener('click', () => {
    const a = selObjs()[0]; if (!a) return;
    styleSet(key, a[key] && a[key] !== 'none' ? 'none' : fallback); commit();
  });
}
wireColor('#fill-color', '#fill-hex', '#fill-none', 'fill', '#3b3bf5');

// Gradient fills. Gradient edits apply to every selected shape that has a gradient.
const gradTargets = () => selObjs().filter(hasGrad);
function setFillType(ft) {
  const list = selObjs().filter(o => o.kind !== 'line' && o.kind !== 'image');
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
function wireStop(prefix, last) {
  const c = $(prefix + '-color'), h = $(prefix + '-hex');
  const apply = v => {
    const list = gradTargets();
    list.forEach(o => { const st = o.grad.stops; st[last ? st.length - 1 : 0].c = v; syncGradFill(o); });
    rememberStyle(list[0]);
  };
  c.addEventListener('input', () => { apply(c.value.toLowerCase()); render(); });
  c.addEventListener('change', () => commit());
  h.addEventListener('change', () => { const v = normHex(h.value.trim()); if (v) { apply(v); commit(); } else updateInspector(); });
  h.addEventListener('keydown', e => { if (e.key === 'Enter') h.blur(); });
}
wireStop('#gs-from', false);
wireStop('#gs-to', true);
$('#grad-angle').addEventListener('change', e => {
  const v = parseFloat(e.target.value), list = gradTargets().filter(o => o.grad.type === 'linear');
  if (!isFinite(v) || !list.length) { updateInspector(); return; }
  list.forEach(o => setGradAngle(o, normDeg(v)));
  rememberStyle(list[0]); commit();
});
$('#grad-reverse').addEventListener('click', () => {
  const list = gradTargets(); if (!list.length) return;
  list.forEach(o => { reverseGrad(o.grad); syncGradFill(o); });
  rememberStyle(list[0]); commit();
});
wireColor('#stroke-color', '#stroke-hex', '#stroke-none', 'stroke', '#151936');
$('#stroke-w').addEventListener('change', e => { const v = parseFloat(e.target.value); if (!isFinite(v)) return updateInspector(); styleSet('sw', clamp(v, 0, 300)); commit(); });
$('#stroke-dash').addEventListener('change', e => { styleSet('dash', e.target.value); commit(); });
$('#stroke-join').addEventListener('change', e => { styleSet('join', e.target.value); commit(); });
$('#opacity').addEventListener('input', e => { styleSet('opacity', e.target.value / 100); });
$('#opacity').addEventListener('change', () => commit());
(function palette() {
  const cols = ['#151936', '#ffffff', '#3b3bf5', '#00a6a6', '#22b573', '#ffd23f', '#ff9f1c', '#ff5a4f', '#ec3f8c', '#8a4fff', '#8c92ad', '#dfe3f3'];
  const box = $('#palette');
  cols.forEach(c => {
    const b = elt('button', 'sw'); b.style.background = c; b.title = c + '. Click to fill, Shift-click to outline.'; b.setAttribute('aria-label', 'Color ' + c);
    b.addEventListener('click', e => { if (!S.sel.size) return; styleSet(e.shiftKey ? 'stroke' : 'fill', c); commit(); });
    box.appendChild(b);
  });
})();

// Combine + arrange
$$('[data-bool]').forEach(b => b.addEventListener('click', () => runBoolean(b.dataset.bool)));
$('#btn-flatten').addEventListener('click', flattenSelected);
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
$('#btn-del').addEventListener('click', deleteSelected);

