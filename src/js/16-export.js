/* =====================================================================
   Export (SVG, PNG, JPG, WebP)
   ===================================================================== */
const X = { fmt: 'png', area: 'artboard', scale: 2, transparent: false, quality: 0.92, name: 'my-drawing' };
const MAX_DIM = 8192, MAX_PIXELS = 40e6;
function exportBox() {
  const sel = selObjs();
  if (X.area === 'selection' && sel.length) {
    const u = unionBox(sel), pad = Math.max(0, ...sel.map(o => hasPaint(o) && o.stroke && o.stroke !== 'none' ? o.sw : 0)) * 1.5 + 1;
    return { x: u.x - pad, y: u.y - pad, w: u.w + pad * 2, h: u.h + pad * 2, objs: sel };
  }
  return { x: 0, y: 0, w: doc.w, h: doc.h, objs: doc.objects };
}
function exportBg() {
  if (X.fmt === 'jpg') return doc.bg === 'transparent' ? '#ffffff' : doc.bg;
  if (X.transparent || doc.bg === 'transparent') return null;
  return doc.bg;
}
function exportDims() {
  const b = exportBox(), sc = X.fmt === 'svg' ? 1 : X.scale;
  return { box: b, w: Math.max(1, Math.round(b.w * sc)), h: Math.max(1, Math.round(b.h * sc)) };
}
function segSet(id, val) { $$('#' + id + ' button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === String(val) ? 'true' : 'false')); }
function updateExportUI() {
  const raster = X.fmt !== 'svg';
  if (!S.sel.size && X.area === 'selection') X.area = 'artboard';
  segSet('ex-fmt', X.fmt); segSet('ex-area', X.area); segSet('ex-scale', X.scale);
  $('#ex-scale-wrap').hidden = !raster;
  $('#ex-q-wrap').hidden = !(X.fmt === 'jpg' || X.fmt === 'webp');
  $('#ex-trans-wrap').hidden = X.fmt === 'jpg';
  const forcedClear = doc.bg === 'transparent';
  $('#ex-trans').checked = forcedClear || X.transparent; $('#ex-trans').disabled = forcedClear;
  const selBtn = $('#ex-area button[data-v="selection"]'); selBtn.disabled = !S.sel.size; selBtn.style.opacity = S.sel.size ? '' : '.4';
  if (!S.sel.size && X.area === 'selection') X.area = 'artboard';
  const d = exportDims(), warn = $('#ex-warn');
  const tooBig = raster && (d.w > MAX_DIM || d.h > MAX_DIM || d.w * d.h > MAX_PIXELS);
  warn.hidden = !tooBig; warn.textContent = tooBig ? 'That is too large for a browser to draw. Choose a smaller size.' : '';
  $('#ex-go').disabled = tooBig;
  $('#ex-meta').textContent = raster ? d.w + ' \u00d7 ' + d.h + ' pixels' : rnd(d.box.w, 1) + ' \u00d7 ' + rnd(d.box.h, 1) + ' units. Scales to any size.';
  $('#ex-go').textContent = 'Download ' + X.fmt.toUpperCase();
  const bg = exportBg();
  const pv = buildSVG(d.box.objs, d.box, d.box.w, d.box.h, bg);
  if (!raster && pv.length > 300000) $('#ex-meta').textContent += ' The file is about ' + fmtMB(pv.length) + ' MB because the photos are included.';
  $('#ex-preview').src = svgDataUrl(pv);
}
const svgDataUrl = s => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
function openExport() {
  closeMenus();
  if (!doc.objects.length) { toast('The page is empty. Draw something first.'); return; }
  if (!S.sel.size && X.area === 'selection') X.area = 'artboard';
  $('#ex-name').value = X.name; $('#ex-q').value = Math.round(X.quality * 100);
  $('#export-overlay').hidden = false; updateExportUI();
  setTimeout(() => $('#ex-go').focus(), 20);
}
function closeExport() { $('#export-overlay').hidden = true; }
function bindSeg(id, key, num) {
  $$('#' + id + ' button').forEach(b => b.addEventListener('click', () => { if (b.disabled) return; X[key] = num ? +b.dataset.v : b.dataset.v; updateExportUI(); }));
}
bindSeg('ex-fmt', 'fmt'); bindSeg('ex-area', 'area'); bindSeg('ex-scale', 'scale', true);
$('#ex-trans').addEventListener('change', e => { X.transparent = e.target.checked; updateExportUI(); });
$('#ex-q').addEventListener('input', e => { X.quality = e.target.value / 100; });
$('#ex-name').addEventListener('input', e => { X.name = e.target.value; });
$('#ex-cancel').addEventListener('click', closeExport);
$('#export-overlay').addEventListener('pointerdown', e => { if (e.target.id === 'export-overlay') closeExport(); });
$('#btn-export').addEventListener('click', openExport);

function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('The drawing could not be rasterized.')); im.src = url; });
}
async function rasterize(objs, box, w, h, fmt, quality, bg) {
  // The background goes inside the SVG (for JPG too) so blend modes mix with it, as they do on screen
  const svg = buildSVG(objs, box, w, h, bg || null);
  const img = await loadImage(svgDataUrl(svg));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  if (fmt === 'jpg') { ctx.fillStyle = bg || '#ffffff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(img, 0, 0, w, h);
  const mime = fmt === 'jpg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png';
  const blob = await new Promise(r => cv.toBlob(r, mime, quality));
  if (!blob) throw new Error('Your browser could not create the image. Try a smaller size.');
  if (blob.type !== mime) throw new Error('This browser cannot save ' + fmt.toUpperCase() + '. Try PNG.');
  return blob;
}
let downloadsP = null;
try { if (window.claude && typeof window.claude.use === 'function') downloadsP = window.claude.use('downloads').catch(() => null); } catch (_) { downloadsP = null; }
async function saveFile(filename, blob) {
  const dl = downloadsP ? await downloadsP : null;
  if (dl) {
    try { await dl.save({ filename, data: blob }); return 'saved'; }
    catch (err) { if (err && err.code === 'declined') return 'declined'; throw new Error((err && err.message) || 'The file could not be saved.'); }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  return 'saved';
}
const safeName = s => (String(s || '').trim().replace(/[^\w\- .()]+/g, '').replace(/\s+/g, ' ').slice(0, 60) || 'my-drawing');
$('#ex-go').addEventListener('click', async () => {
  const go = $('#ex-go'); go.disabled = true;
  try {
    const d = exportDims(), bg = exportBg(), name = safeName(X.name);
    let blob;
    if (X.fmt === 'svg') blob = new Blob([buildSVG(d.box.objs, d.box, d.box.w, d.box.h, bg)], { type: 'image/svg+xml' });
    else blob = await rasterize(d.box.objs, d.box, d.w, d.h, X.fmt, X.quality, bg);
    const r = await saveFile(name + '.' + X.fmt, blob);
    if (r === 'saved') { toast('Saved ' + name + '.' + X.fmt); closeExport(); }
  } catch (err) { toast(err.message || 'Export failed.'); }
  go.disabled = false; updateExportUI();
});

