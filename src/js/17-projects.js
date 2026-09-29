/* =====================================================================
   Projects: save, open, new, example
   ===================================================================== */
const KINDS = ['rect', 'ellipse', 'polygon', 'line', 'text', 'path', 'image'];
function sanitizeDoc(d) {
  const out = blankDoc();
  const num = (v, def, a, b) => { v = +v; return Number.isFinite(v) ? clamp(v, a, b) : def; };
  const col = (v, def) => (v === 'none' || (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v))) ? v : def;
  out.w = num(d.w, 800, 16, 8000); out.h = num(d.h, 600, 16, 8000);
  out.bg = d.bg === 'transparent' ? 'transparent' : col(d.bg, '#ffffff');
  let missingFont = false, missingPhoto = false;
  // Groups get new ids, like objects do; gmap turns a file's group id into the new group
  const gmap = new Map(), has = v => v !== null && v !== undefined && gmap.has(+v);
  (Array.isArray(d.groups) ? d.groups.slice(0, 5000) : []).forEach(r => {
    if (!r || !Number.isFinite(+r.id) || gmap.has(+r.id)) return;
    const g = { id: out.nextId++, name: typeof r.name === 'string' ? r.name.slice(0, 60) : '', parent: r.parent, hidden: !!r.hidden, locked: !!r.locked };
    gmap.set(+r.id, g); out.groups.push(g);
  });
  out.groups.forEach(g => { g.parent = has(g.parent) ? gmap.get(+g.parent).id : null; });
  (Array.isArray(d.objects) ? d.objects : []).forEach(r => {
    if (!r || KINDS.indexOf(r.kind) < 0) return;
    const o = {
      id: out.nextId++, kind: r.kind, name: typeof r.name === 'string' ? r.name.slice(0, 60) : '',
      x: num(r.x, 0, -1e6, 1e6), y: num(r.y, 0, -1e6, 1e6), w: num(r.w, 100, 0.01, 1e5), h: num(r.h, 100, 0.01, 1e5), rot: num(r.rot, 0, -360, 360),
      fill: col(r.fill, 'none'), stroke: col(r.stroke, 'none'), sw: num(r.sw, 2, 0, 500), opacity: num(r.opacity, 1, 0, 1),
      join: ['miter', 'round', 'bevel'].indexOf(r.join) >= 0 ? r.join : 'miter', dash: ['solid', 'dashed', 'dotted'].indexOf(r.dash) >= 0 ? r.dash : 'solid',
      hidden: !!r.hidden, locked: !!r.locked
    };
    if (o.kind !== 'line') { if (r.fx) o.fx = true; if (r.fy) o.fy = true; }
    if (has(r.parent)) o.parent = gmap.get(+r.parent).id;
    if (BLEND_IDS.indexOf(r.blend) > 0) o.blend = r.blend;   // 0 is normal, which isn't stored
    if (o.kind !== 'image' && CAPS.indexOf(r.cap) >= 0) o.cap = r.cap;
    if (o.kind === 'image') {
      o.img = typeof r.img === 'string' ? r.img : '';
      if (!images.has(o.img)) { missingPhoto = true; return; }
    } else if (o.kind !== 'line' && r.pic) {
      if (typeof r.pic.id === 'string' && images.has(r.pic.id)) o.pic = { id: r.pic.id, dx: num(r.pic.dx, 0, -1e5, 1e5), dy: num(r.pic.dy, 0, -1e5, 1e5), s: num(r.pic.s, 1, 0.001, 100) };
      else missingPhoto = true;
    }
    if (o.kind !== 'line' && o.kind !== 'image' && r.grad) { const g = sanitizeGrad(r.grad); if (g) { o.grad = g; o.fill = g.stops[0].c; } }
    if (o.kind === 'rect') o.r = num(r.r, 0, 0, 1e5);
    if (o.kind === 'polygon') { o.sides = Math.round(num(r.sides, 5, 3, 24)); o.star = !!r.star; o.inner = num(r.inner, 0.45, 0.1, 0.95); }
    if (o.kind === 'line') { o.x1 = num(r.x1, 0, -1e6, 1e6); o.y1 = num(r.y1, 0, -1e6, 1e6); o.x2 = num(r.x2, 0, -1e6, 1e6); o.y2 = num(r.y2, 0, -1e6, 1e6); }
    if (o.kind === 'text') {
      o.text = typeof r.text === 'string' ? r.text.slice(0, 5000) : 'Text';
      if (fonts[r.font]) o.font = r.font; else { o.font = DEFAULT_FONT; missingFont = true; }
      o.size = num(r.size, 64, 4, 1200); o.align = ['left', 'center', 'right'].indexOf(r.align) >= 0 ? r.align : 'left';
      o.lh = num(r.lh, 1.2, 0.6, 3); o.ls = num(r.ls, 0, -0.2, 2);
    }
    if (o.kind === 'path') {
      if (!r.nat || typeof r.nat.d !== 'string') return;
      o.nat = { d: r.nat.d, w: num(r.nat.w, o.w, 0.001, 1e5), h: num(r.nat.h, o.h, 0.001, 1e5) };
    }
    try { refresh(o); out.objects.push(o); } catch (e) { /* skip broken objects */ }
  });
  normalizeGroups(out);
  out._missingFont = missingFont; out._missingPhoto = missingPhoto;
  return out;
}
async function saveProject() {
  closeMenus();
  const pics = {};
  docImageIds(doc).forEach(id => { const r = images.get(id); if (r) pics[id] = { name: r.name, w: r.w, h: r.h, mime: r.mime, data: r.dataUrl }; });
  const blob = new Blob([JSON.stringify({ app: 'cutout', version: 2, appVersion: APP_VERSION, doc, images: pics })], { type: 'application/json' });
  try { const r = await saveFile(safeName(X.name) + '.cutout.json', blob); if (r === 'saved') toast('Project saved.'); }
  catch (err) { toast(err.message || 'The project could not be saved.'); }
}
function dataUrlToBlob(url) {
  const i = url.indexOf(',');
  if (i < 0 || !/^data:image\/(png|jpeg|webp);base64$/.test(url.slice(0, i))) return null;
  try {
    const bin = atob(url.slice(i + 1)), u = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
    return new Blob([u], { type: url.slice(5, url.indexOf(';')) });
  } catch (e) { return null; }
}
// Accept a photo from a project file only if it is a genuine, reasonably sized picture
async function adoptProjectPhoto(r) {
  if (!r || typeof r.data !== 'string' || r.data.length > LIMITS.fileBytes * 1.4) return null;
  const blob = dataUrlToBlob(r.data);
  if (!blob || blob.size > LIMITS.fileBytes) return null;
  let img;
  try { img = await loadPicture(r.data); } catch (e) { return null; }
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h || w * h > LIMITS.srcPixels) return null;
  return { id: uid(), blob, dataUrl: r.data, w, h, mime: blob.type, bytes: blob.size, name: baseName(r.name), stored: false };
}
async function openProject(file) {
  try {
    const data = JSON.parse(await file.text());
    const raw = data && data.doc ? data.doc : data, pics = data && data.images && typeof data.images === 'object' ? data.images : {};
    const map = new Map();
    let dropped = 0;
    for (const id of rawImageIds(raw)) {
      const rec = map.size < LIMITS.photos ? await adoptProjectPhoto(pics[id]) : null;
      if (rec) map.set(id, rec); else dropped++;
    }
    // point the drawing at the freshly registered photo ids
    (Array.isArray(raw.objects) ? raw.objects : []).forEach(o => {
      if (!o) return;
      if (typeof o.img === 'string') o.img = map.has(o.img) ? map.get(o.img).id : '';
      if (o.pic && typeof o.pic.id === 'string') o.pic.id = map.has(o.pic.id) ? map.get(o.pic.id).id : '';
    });
    map.forEach(rec => images.set(rec.id, rec));
    const d = sanitizeDoc(raw);
    const miss = d._missingFont, lostPhoto = dropped || d._missingPhoto;
    delete d._missingFont; delete d._missingPhoto;
    doc = d; S.sel = new Set(); resetHistory(); fit();
    toast(miss ? 'Opened. A font used in this project was missing, so Inter was used instead.' : lostPhoto ? 'Opened. Some photos could not be loaded.' : 'Project opened.');
  } catch (err) { toast('That file is not a Cutout project.'); }
}

