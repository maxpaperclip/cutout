/* =====================================================================
   Photos: import, shrink, store
   ===================================================================== */
const baseName = s => String(s || 'Photo').replace(/\.[^.]+$/, '').replace(/[^\w\-. ()]+/g, '').trim().slice(0, 40) || 'Photo';
const loadPicture = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('bad picture')); im.src = src; });
const canvasBlob = (cv, mime, q) => new Promise(res => cv.toBlob(res, mime, q));
function hasTransparency(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}
// Check the picture, shrink it, and re-encode it. Re-encoding also removes camera data such as location.
async function processPhoto(file) {
  const name = baseName(file.name), label = '\u201c' + name + '\u201d';
  if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) throw new Error(label + ' is not a JPG, PNG, WebP or GIF picture.');
  if (file.size > LIMITS.fileBytes) throw new Error(label + ' is ' + fmtMB(file.size) + ' MB. Photos can be up to ' + fmtMB(LIMITS.fileBytes) + ' MB. Try a smaller copy.');
  let img;
  try { img = await loadPicture(await readDataUrl(file)); } catch (e) { throw new Error(label + ' could not be opened. It may be damaged.'); }
  const nw = img.naturalWidth, nh = img.naturalHeight;
  if (!nw || !nh) throw new Error(label + ' could not be opened. It may be damaged.');
  if (nw * nh > LIMITS.srcPixels) throw new Error(label + ' is about ' + Math.round(nw * nh / 1e6) + ' megapixels, which is too big to open safely (the limit is ' + Math.round(LIMITS.srcPixels / 1e6) + '). Try a smaller copy.');
  const jpegSrc = file.type === 'image/jpeg';
  let edge = Math.min(LIMITS.edge, Math.max(nw, nh)), blob = null, tw = nw, th = nh;
  for (let attempt = 0; attempt < 4; attempt++) {
    const k = Math.min(1, edge / Math.max(nw, nh));
    tw = Math.max(1, Math.round(nw * k)); th = Math.max(1, Math.round(nh * k));
    const cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, tw, th);
    if (jpegSrc) blob = await canvasBlob(cv, 'image/jpeg', 0.86);
    else if (hasTransparency(ctx, tw, th)) blob = await canvasBlob(cv, 'image/png');
    else {
      blob = await canvasBlob(cv, 'image/png');
      if (blob && blob.size > 1.2 * 1048576) { const j = await canvasBlob(cv, 'image/jpeg', 0.88); if (j && j.size < blob.size) blob = j; }
    }
    cv.width = cv.height = 0;   // give the pixels back right away
    if (!blob) throw new Error(label + ' could not be shrunk. Try a different picture.');
    if (blob.size <= LIMITS.storedBytes) break;
    edge = Math.round(edge * 0.75);
  }
  return { id: uid(), blob, dataUrl: await readDataUrl(blob), w: tw, h: th, mime: blob.type, bytes: blob.size, name, stored: false };
}
const isSVGFile = f => /^image\/svg\+xml$/i.test(f.type) || /\.svg$/i.test(f.name || '');
// What to tell the student after an SVG comes in
function svgMessage(r) {
  const c = r.counts, n = r.ids.length;
  let t = 'Added ' + n + (n === 1 ? ' object' : ' objects') + (r.top ? ' as the group \u201c' + r.top.name + '\u201d' : '') + '.';
  if (r.scaled) t += ' It was shrunk to fit the page.';
  if (c.text) t += ' Text uses Cutout\u2019s own font.';
  if (c.tooMany) t += ' The file had more than ' + SVG_LIMITS.objects + ' parts, so only the first ones were added.';
  else if (c.skipped) t += ' A few parts Cutout can\u2019t show were left out.';
  return t;
}
let persistAsked = false;
async function importFiles(list) {
  const files = Array.from(list || []);
  if (!files.length) return;
  importing++;
  const problems = [], svgDone = [];
  let added = 0, off = 0;
  try {
    for (const f of files) {
      if (isSVGFile(f)) {   // an SVG comes in as editable shapes (see SVG import)
        try { const r = await importSVGFile(f); svgDone.push(r); S.sel = new Set(r.ids); added++; }
        catch (err) { problems.push(err.message); }
        continue;
      }
      if (docPhotoIds(doc).size >= LIMITS.photos) { problems.push('This drawing already has the most photos it can hold (' + LIMITS.photos + '). Delete one to add another.'); break; }
      let rec;
      try { rec = await processPhoto(f); } catch (err) { problems.push(err.message); continue; }
      images.set(rec.id, rec);
      if (DB.ok) { try { await idbPut('images', { id: rec.id, blob: rec.blob, w: rec.w, h: rec.h, mime: rec.mime, name: rec.name }); rec.stored = true; } catch (e) { /* retried when autosaving */ } }
      const k = Math.min(1, (doc.w * 0.8) / rec.w, (doc.h * 0.8) / rec.h), w = rnd(rec.w * k, 2), h = rnd(rec.h * k, 2);
      const im = makeImage(rec, { x: rnd((doc.w - w) / 2 + off, 2), y: rnd((doc.h - h) / 2 + off, 2), w, h });
      doc.objects.push(im); S.sel = new Set([im.id]); added++; off += 24;
    }
  } finally { importing--; }
  if (added) {
    setTool('select'); commit();
    if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; navigator.storage.persist().catch(() => {}); }
  }
  svgDone.forEach(r => { if (r.photoProblem) problems.push(r.photoProblem); });
  if (problems.length) toast(problems[0] + (problems.length > 1 ? ' (' + (problems.length - 1) + ' more could not be added.)' : ''));
  else if (svgDone.length && svgDone.length === added) toast(svgMessage(svgDone[svgDone.length - 1]));
  else if (added) toast(added === 1 ? 'Photo added. Select a shape too, then choose Use shapes as mask.' : added + ' photos and drawings added.');
}
async function updatePhotoInfo() {
  const el = $('#photo-info'); if (!el) return;
  const ids = docPhotoIds(doc); let bytes = 0;
  ids.forEach(id => { const r = images.get(id); if (r) bytes += r.bytes; });
  let t = 'Photos in this drawing: ' + ids.size + ' of ' + LIMITS.photos + (ids.size ? ' (' + fmtMB(bytes) + ' MB)' : '') + '. Files up to ' + fmtMB(LIMITS.fileBytes) + ' MB are accepted, shrunk to fit ' + LIMITS.edge + ' pixels, and stripped of location data. ';
  t += DB.ok ? 'Autosave keeps your work on this device.' : 'Autosave cannot store photos in this browser, so use File > Save project to keep them.';
  el.textContent = t;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      if (e && e.quota) { const left = e.quota - (e.usage || 0); el.textContent = t + ' Space left for saving in this browser: about ' + (left > 1e9 ? (left / 1e9).toFixed(1) + ' GB' : Math.round(left / 1e6) + ' MB') + '.'; }
    }
  } catch (e) { /* estimate is optional */ }
}

function newDrawing() { closeMenus(); doc = blankDoc(); S.sel = new Set(); commit(); fit(); toast('New drawing. Undo brings the last one back.'); }
function loadExample() {
  closeMenus();
  doc = blankDoc(); doc.bg = '#eef0fb'; S.sel = new Set();
  const add = (k, p) => { const o = newShape(k, p); doc.objects.push(o); return o; };
  add('text', { text: 'CUTOUT', font: 'bungee', size: 118, x: 60, y: 40, fill: '#151936', name: 'Title' });
  add('ellipse', { x: 70, y: 230, w: 250, h: 250, fill: '#ff5a4f', name: 'Circle' });
  add('polygon', { x: 190, y: 250, w: 290, h: 290, star: true, sides: 5, inner: 0.42, fill: '#ffd23f', rot: 14, name: 'Star' });
  add('rect', { x: 440, y: 260, w: 300, h: 200, r: 36, fill: '#00a6a6', name: 'Rounded rectangle' });
  add('text', { text: 'Select two shapes, then try Combine.', font: 'inter', size: 22, x: 60, y: 548, fill: '#575d7c', name: 'Hint' });
  resetHistory(); fit(); switchTab('design');
}

