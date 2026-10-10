/* =====================================================================
   Projects: save, open, new, example
   ===================================================================== */
const KINDS = ['rect', 'ellipse', 'polygon', 'line', 'text', 'path', 'image'];   // 'line' only in files from before v1.14
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
    if (r.fx) o.fx = true;
    if (r.fy) o.fy = true;
    if (r.wrap === true && r.kind !== 'text') { o.wrap = true; if (Number.isFinite(+r.wgap) && +r.wgap >= 0) o.wgap = num(r.wgap, 8, 0, 200); }   // text with a box flows around it (see 04i-text-wrap.js)
    if (has(r.parent)) o.parent = gmap.get(+r.parent).id;
    if (BLEND_IDS.indexOf(r.blend) > 0) o.blend = r.blend;   // 0 is normal, which isn't stored
    if (hasPaint(o) && CAPS.indexOf(r.cap) >= 0) o.cap = r.cap;
    if (typeof r.erase === 'string' && r.erase) { if (images.has(r.erase)) o.erase = r.erase; else missingPhoto = true; }   // see 04d-erase.js
    if (hasPixels(o)) {
      o.img = typeof r.img === 'string' ? r.img : '';
      if (!images.has(o.img)) { missingPhoto = true; return; }
      if (r.paint) o.paint = true;   // a layer painted with the Brush tool
    } else if (r.kind !== 'line' && r.pic) {
      if (typeof r.pic.id === 'string' && images.has(r.pic.id)) o.pic = { id: r.pic.id, dx: num(r.pic.dx, 0, -1e5, 1e5), dy: num(r.pic.dy, 0, -1e5, 1e5), s: num(r.pic.s, 1, 0.001, 100) };
      else missingPhoto = true;
    }
    if (r.kind !== 'line' && hasPaint(o) && r.grad) { const g = sanitizeGrad(r.grad); if (g) { o.grad = g; o.fill = g.stops[0].c; } }
    if (o.kind === 'rect') o.r = num(r.r, 0, 0, 1e5);
    if (o.kind === 'polygon') { o.sides = Math.round(num(r.sides, 5, 3, 24)); o.star = !!r.star; o.inner = num(r.inner, 0.45, 0.1, 0.95); }
    if (r.kind === 'line') {   // lines became two-point plain shapes in v1.14
      const P = k => num(r[k], 0, -1e6, 1e6);
      Object.assign(o, lineGeometry({ x: P('x1'), y: P('y1') }, { x: P('x2'), y: P('y2') }), { kind: 'path', rot: 0 });
      delete o.fx; delete o.fy;
      if (!r.fill || r.fill === 'none') o.fill = 'none';
    }
    if (o.kind === 'text') {
      o.text = typeof r.text === 'string' ? r.text.slice(0, 5000) : 'Text';
      if (fonts[r.font]) o.font = r.font; else { o.font = DEFAULT_FONT; missingFont = true; }
      o.size = num(r.size, 64, 4, 1200); o.align = ['left', 'center', 'right', 'justify'].indexOf(r.align) >= 0 ? r.align : 'left';
      o.lh = num(r.lh, 1.2, 0.6, 3); o.ls = num(r.ls, 0, -0.2, 2);
      if (Number.isFinite(+r.bw) && +r.bw > 0) o.bw = num(r.bw, 100, 1, 1e5);   // the width of a text wrapped to a box
      if (Number.isFinite(+r.indent) && +r.indent > 0) o.indent = num(r.indent, 0, 0, 20);   // how far in each paragraph's first line starts, in ems
      if (r.hang === true) o.hang = true;    // quotes and hyphens hang into the margin (all of their width)
      else if (typeof r.hang === 'number' && r.hang > 0) o.hang = num(r.hang, 1, 0.05, 1.5);   // (or just part of it)
      if (r.hyph === true) o.hyph = true;    // long words are broken with a hyphen
      const runs = sanitizeRuns(r.runs, o.text.length, k => !!fonts[k]);   // letters set apart from the rest
      if (runs) o.runs = runs;
    }
    if (r.kind === 'path') {   // (a converted old line already has its outline)
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
  docImageIds(doc).forEach(id => { const r = images.get(id); if (r) pics[id] = { name: r.name, w: r.w, h: r.h, mime: r.mime, data: r.dataUrl, mask: r.mask ? true : undefined }; });
  const blob = new Blob(['{"app":"friendshaped","version":2,"appVersion":' + JSON.stringify(APP_VERSION) + ',"doc":' + docJSON(doc) + ',"images":' + JSON.stringify(pics) + '}'], { type: 'application/json' });
  try { const r = await saveFile(safeName(X.name) + '.friendshaped.json', blob); if (r === 'saved') toast('Project saved.'); }
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
async function adoptProjectPhoto(r, mask) {
  if (!r || typeof r.data !== 'string' || r.data.length > LIMITS.fileBytes * 1.4) return null;
  const blob = dataUrlToBlob(r.data);
  if (!blob || blob.size > LIMITS.fileBytes) return null;
  let img;
  try { img = await loadPicture(r.data); } catch (e) { return null; }
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h || w * h > LIMITS.srcPixels) return null;
  return { id: uid(), blob, dataUrl: r.data, w, h, mime: blob.type, bytes: blob.size, name: mask ? 'Erased areas' : baseName(r.name), stored: false, mask: !!mask };
}
async function openProject(file) {
  try {
    const data = JSON.parse(await file.text());
    const raw = data && data.doc ? data.doc : data, pics = data && data.images && typeof data.images === 'object' ? data.images : {};
    const map = new Map();
    let dropped = 0;
    const maskIds = rawEraseIds(raw), paintIds = rawPaintIds(raw);   // erase masks and paint layers don't count against the photo limit
    let nPhotos = 0;
    for (const id of rawImageIds(raw)) {
      const isMask = maskIds.has(id), free = isMask || paintIds.has(id);
      const rec = free || nPhotos < LIMITS.photos ? await adoptProjectPhoto(pics[id], isMask) : null;
      if (rec) { map.set(id, rec); if (!free) nPhotos++; } else dropped++;
    }
    // point the drawing at the freshly registered photo ids
    (Array.isArray(raw.objects) ? raw.objects : []).forEach(o => {
      if (!o) return;
      if (typeof o.img === 'string') o.img = map.has(o.img) ? map.get(o.img).id : '';
      if (o.pic && typeof o.pic.id === 'string') o.pic.id = map.has(o.pic.id) ? map.get(o.pic.id).id : '';
      if (typeof o.erase === 'string') o.erase = map.has(o.erase) ? map.get(o.erase).id : '';
    });
    map.forEach(rec => images.set(rec.id, rec));
    await fontsWithin(rawFontKeys(raw), 4000);   // fonts this drawing uses that aren't here yet (hosted build); a slow one is laid out again when it arrives (fontArrived)
    const d = sanitizeDoc(raw);
    const miss = d._missingFont, lostPhoto = dropped || d._missingPhoto;
    delete d._missingFont; delete d._missingPhoto;
    doc = d; S.sel = new Set(); resetHistory(); fit();
    toast(miss ? 'Opened. A font used in this project was missing, so Inter was used instead.' : lostPhoto ? 'Opened. Some photos could not be loaded.' : 'Project opened.');
  } catch (err) { toast('That file is not a FriendShaped project.'); }
}

