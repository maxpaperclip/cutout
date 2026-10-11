/* =====================================================================
   Page tab
   ===================================================================== */
const PRESETS = [['800 \u00d7 600  Default', 800, 600], ['1080 \u00d7 1080  Square', 1080, 1080], ['1920 \u00d7 1080  Slide', 1920, 1080], ['1200 \u00d7 630  Social card', 1200, 630], ['512 \u00d7 512  Icon', 512, 512], ['816 \u00d7 1056  Letter page', 816, 1056], ['794 \u00d7 1123  A4 page', 794, 1123]];
(function () {
  const sel = $('#pg-preset');
  PRESETS.forEach((p, i) => { const o = elt('option', '', p[0]); o.value = i; sel.appendChild(o); });
  const c = elt('option', '', 'Custom'); c.value = 'custom'; sel.appendChild(c);
})();
const transOf = opacity => Math.round((1 - opacity) * 100);   // the sliders show transparency; what is kept is opacity
function updatePageTab() {
  setNum($('#pg-w'), doc.w); setNum($('#pg-h'), doc.h);
  const i = PRESETS.findIndex(p => p[1] === doc.w && p[2] === doc.h);
  $('#pg-preset').value = i < 0 ? 'custom' : String(i);
  const tr = doc.bg === 'transparent';
  $('#bg-color').value = tr ? '#ffffff' : toHex6(doc.bg);
  if (document.activeElement !== $('#bg-hex')) $('#bg-hex').value = tr ? '' : toHex6(doc.bg);
  $('#bg-none').setAttribute('aria-pressed', tr ? 'true' : 'false');
  $('#grid-show').checked = S.showGrid; $('#grid-snap').checked = S.snap; setNum($('#grid-size'), S.grid);
  const gr = gridsOf(doc), c = gr.columns, b = gr.baseline;
  $('#cg-show').checked = c.show; $('#cg-snap').checked = c.snap; $('#cg-color').value = c.color;
  setNum($('#cg-count'), c.count); setNum($('#cg-gutter'), c.gutter); setNum($('#cg-left'), c.left); setNum($('#cg-right'), c.right);
  $('#bl-show').checked = b.show; $('#bl-snap').checked = b.snap; $('#bl-color').value = b.color;
  setNum($('#bl-size'), b.size); setNum($('#bl-lh'), b.lh); setNum($('#bl-top'), b.top); setNum($('#bl-bottom'), b.bottom);
  [['cg', c], ['bl', b]].forEach(([p, o]) => {
    if (document.activeElement !== $('#' + p + '-trans')) $('#' + p + '-trans').value = transOf(o.opacity);
    $('#' + p + '-trans-val').textContent = transOf(o.opacity) + '%';
  });
  $('#bl-info').textContent = 'Lines are ' + rnd(baselineRange(b, doc.h).step, 2) + ' px apart (font size × line height). Top and bottom are where the grid begins and ends.';
  if (!$('[data-pane="page"]').hidden) updatePhotoInfo();
}
$('#pg-preset').addEventListener('change', e => { if (e.target.value === 'custom') return; const p = PRESETS[+e.target.value]; doc.w = p[1]; doc.h = p[2]; commit(); fit(); });
$('#pg-w').addEventListener('change', e => { const v = parseFloat(e.target.value); if (isFinite(v)) { doc.w = clamp(Math.round(v), 16, 8000); commit(); fit(); } else updatePageTab(); });
$('#pg-h').addEventListener('change', e => { const v = parseFloat(e.target.value); if (isFinite(v)) { doc.h = clamp(Math.round(v), 16, 8000); commit(); fit(); } else updatePageTab(); });
$('#bg-color').addEventListener('input', e => { doc.bg = e.target.value; drawArtboard(); });
$('#bg-color').addEventListener('change', () => commit());
$('#bg-hex').addEventListener('change', e => { const v = e.target.value.trim(); if (HEX.test(v)) { doc.bg = v.toLowerCase(); commit(); } else updatePageTab(); });
$('#bg-none').addEventListener('click', () => { doc.bg = doc.bg === 'transparent' ? '#ffffff' : 'transparent'; commit(); });
$('#grid-show').addEventListener('change', e => { S.showGrid = e.target.checked; drawArtboard(); });
$('#grid-snap').addEventListener('change', e => { S.snap = e.target.checked; });
$('#grid-size').addEventListener('change', e => { const v = parseFloat(e.target.value); if (isFinite(v)) S.grid = clamp(Math.round(v), 2, 200); updatePageTab(); drawArtboard(); });


/* ---------- column and baseline grids (see 04j-grids.js) ----------
   They are kept on the drawing (doc.grids), so every change is one undo step. The two sliders and the two color
   fields change the picture while they are dragged and are recorded when they are let go, like the page color. */
function editGrids(fn) { const g = gridsOf(doc); fn(g); doc.grids = sanitizeGrids(g); }
function setGrids(fn) { editGrids(fn); commit(); }
[['cg-show', 'columns', 'show'], ['cg-snap', 'columns', 'snap'], ['bl-show', 'baseline', 'show'], ['bl-snap', 'baseline', 'snap']].forEach(([id, grid, key]) =>
  $('#' + id).addEventListener('change', e => setGrids(g => { g[grid][key] = e.target.checked; })));
[['cg-count', 'columns', 'count'], ['cg-gutter', 'columns', 'gutter'], ['cg-left', 'columns', 'left'], ['cg-right', 'columns', 'right'],
 ['bl-size', 'baseline', 'size'], ['bl-lh', 'baseline', 'lh'], ['bl-top', 'baseline', 'top'], ['bl-bottom', 'baseline', 'bottom']].forEach(([id, grid, key]) =>
  $('#' + id).addEventListener('change', e => {
    const v = parseFloat(e.target.value);
    if (!isFinite(v)) { updatePageTab(); return; }
    setGrids(g => { g[grid][key] = v; });
    e.target.value = rnd(gridsOf(doc)[grid][key], 2);   // (the box may still have the cursor in it: show the value that was kept, which can differ from what was typed)
  }));
[['cg-trans', 'columns'], ['bl-trans', 'baseline']].forEach(([id, grid]) => {
  $('#' + id).addEventListener('input', e => { editGrids(g => { g[grid].opacity = 1 - e.target.value / 100; }); $('#' + id + '-val').textContent = e.target.value + '%'; drawArtboard(); });
  $('#' + id).addEventListener('change', () => commit());
});
[['cg-color', 'columns'], ['bl-color', 'baseline']].forEach(([id, grid]) => {
  $('#' + id).addEventListener('input', e => { editGrids(g => { g[grid].color = e.target.value; }); drawArtboard(); });
  $('#' + id).addEventListener('change', () => commit());
});

// Ctrl+' (Cmd+' on a Mac) shows or hides the grids that are on. It remembers which ones they were for next time (until the page is reloaded),
// and with none on it shows the column grid, so the shortcut always does something you can see.
let gridsWereOn = ['columns'];
function toggleGrids() {
  const g = gridsOf(doc), on = ['columns', 'baseline'].filter(k => g[k].show);
  if (on.length) { gridsWereOn = on; setGrids(x => on.forEach(k => { x[k].show = false; })); }
  else setGrids(x => gridsWereOn.forEach(k => { x[k].show = true; }));
}
