/* =====================================================================
   History + autosave (IndexedDB)
   The drawing (small JSON) and the photos (files) are stored separately.
   ===================================================================== */
/* Undo history: a list of steps, each the drawing as it was after one change.
     step = { json: the drawing (docJSON), ids: the photo ids it uses, change: extra, or undefined }
   A change can carry more than the drawing's JSON: { undo(), redo(), forget(), bytes }. That is for
   changes kept outside the drawing itself, like pixels painted into a paint layer; undo() and redo()
   put them back, and forget() is called when the step is dropped. The history keeps at most
   HISTORY.steps steps and about HISTORY.bytes of memory, dropping the oldest first. */
const HISTORY = { steps: 100, bytes: 48 * 1048576 };
const hist = { steps: [], idx: -1, bytes: 0 };
const stepBytes = st => st.json.length * 2 + ((st.change && st.change.bytes) || 0);
function dropStep(st) { hist.bytes -= stepBytes(st); if (st.change && st.change.forget) { try { st.change.forget(); } catch (e) { /* ignore */ } } }
const AUTOSAVE_KEY = 'cutout.autosave.v1';       // older versions saved here; read once for migration
const DB = { db: null, ok: false };
let importing = 0, suppressSave = false, saveTimer = null, warnedSave = false;
const fmtMB = n => (n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0);

function idbOpen() {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    try {
      if (!window.indexedDB) return finish(null);
      const req = indexedDB.open('cutout', 1);
      req.onupgradeneeded = () => { const db = req.result; db.createObjectStore('images', { keyPath: 'id' }); db.createObjectStore('meta', { keyPath: 'key' }); };
      req.onsuccess = () => finish(req.result);
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
      setTimeout(() => finish(null), 3000);
    } catch (e) { finish(null); }
  });
}
function idbTx(store, mode, fn) {
  return new Promise((resolve, reject) => {
    try {
      const tx = DB.db.transaction(store, mode);
      let result;
      const r = fn(tx.objectStore(store));
      if (r) r.onsuccess = () => { result = r.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('The browser cancelled the save.'));
    } catch (e) { reject(e); }
  });
}
const idbPut = (store, val) => idbTx(store, 'readwrite', s => s.put(val));
const idbGet = (store, key) => idbTx(store, 'readonly', s => s.get(key));
const idbDel = (store, key) => idbTx(store, 'readwrite', s => s.delete(key));
const idbKeys = store => idbTx(store, 'readonly', s => s.getAllKeys());

function setStatus(state, detail) {
  const e = $('#save-status'); if (!e) return;
  e.dataset.state = state;
  e.textContent = state === 'saving' ? 'Saving\u2026' : state === 'saved' ? 'Saved' : state === 'failed' ? 'Not saved' : '';
  e.title = detail || '';
}
function scheduleSave(str) {
  if (suppressSave) return;
  clearTimeout(saveTimer);
  setStatus('saving', 'Saving your drawing on this device.');
  saveTimer = setTimeout(() => persistNow(str), 600);
}
async function persistNow(str) {
  try {
    const ids = (hist.steps[hist.idx] && hist.steps[hist.idx].ids) || new Set();
    if (DB.ok) {
      for (const id of ids) {
        const r = images.get(id);
        if (r && !r.stored) { await idbPut('images', { id: r.id, blob: r.blob, w: r.w, h: r.h, mime: r.mime, name: r.name, mask: !!r.mask }); r.stored = true; }
      }
      await idbPut('meta', { key: 'doc', json: str, at: Date.now() });
      try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) { /* ignore */ }
      setStatus('saved', 'Saved automatically on this device.');
      gcImages();
    } else if (ids.size) {
      throw new Error('nodb');
    } else {
      localStorage.setItem(AUTOSAVE_KEY, str);
      setStatus('saved', 'Saved in this browser.');
    }
    warnedSave = false;
  } catch (err) {
    const quota = err && (err.name === 'QuotaExceededError' || /quota/i.test(String(err.message)));
    const msg = err && err.message === 'nodb' ? 'This browser is not letting Cutout save photos automatically. Use File > Save project to keep your work.'
      : quota ? 'This browser has no space left for autosave. Use File > Save project to keep your work.'
      : 'Autosave did not work. Use File > Save project to keep your work.';
    setStatus('failed', msg);
    if (!warnedSave) { warnedSave = true; toast(msg); }
  }
}
// Forget photos that neither the drawing nor its undo history uses any more
async function gcImages() {
  if (importing) return;
  const keep = new Set(docImageIds(doc));
  hist.steps.forEach(st => st.ids.forEach(id => keep.add(id)));
  if (psn) psn.items.forEach(it => { if (it.o0.img) keep.add(it.o0.img); if (it.o0.pic && it.o0.pic.id) keep.add(it.o0.pic.id); if (it.o0.erase) keep.add(it.o0.erase); });
  const drop = [];
  images.forEach((r, id) => { if (!keep.has(id)) drop.push(id); });
  for (const id of drop) {
    images.delete(id);
    if (DB.ok) { try { await idbDel('images', id); } catch (e) { /* ignore */ } }
  }
}
async function cleanOrphans() {
  if (!DB.ok) return;
  try {
    const keep = docImageIds(doc);
    for (const k of await idbKeys('images')) if (!keep.has(k)) await idbDel('images', k);
  } catch (e) { /* ignore */ }
}
const rawImageIds = d => {
  const s = new Set();
  (Array.isArray(d && d.objects) ? d.objects : []).forEach(o => {
    if (o && typeof o.img === 'string') s.add(o.img);
    if (o && o.pic && typeof o.pic.id === 'string') s.add(o.pic.id);
    if (o && typeof o.erase === 'string') s.add(o.erase);
  });
  return s;
};
// Just the erase masks among them (they don't count as photos)
const rawEraseIds = d => {
  const s = new Set();
  (Array.isArray(d && d.objects) ? d.objects : []).forEach(o => { if (o && typeof o.erase === 'string') s.add(o.erase); });
  return s;
};
function readDataUrl(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('That file could not be read.')); r.readAsDataURL(blob); });
}
async function registerStored(r) {
  const dataUrl = await readDataUrl(r.blob);
  images.set(r.id, { id: r.id, blob: r.blob, dataUrl, w: r.w, h: r.h, mime: r.mime, bytes: r.blob.size, name: r.name || 'Photo', stored: true, mask: !!r.mask });
}
// Open the database and bring back the last drawing with its photos
async function restoreSession() {
  DB.db = await idbOpen(); DB.ok = !!DB.db;
  let raw = null;
  if (DB.ok) { try { const m = await idbGet('meta', 'doc'); raw = m && m.json; } catch (e) { /* fall through */ } }
  if (!raw) { try { raw = localStorage.getItem(AUTOSAVE_KEY); } catch (e) { /* ignore */ } }
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return null; }
  let lost = 0;
  if (DB.ok) {
    for (const id of rawImageIds(parsed)) {
      try { const r = await idbGet('images', id); if (r && r.blob) await registerStored(r); else lost++; } catch (e) { lost++; }
    }
  }
  const d = sanitizeDoc(parsed);
  if (d._missingPhoto) lost = Math.max(lost, 1);
  delete d._missingPhoto; delete d._missingFont;
  return { doc: d, lost };
}

// Record the drawing as a new undo step (if anything changed) and redraw everything.
// change: optional, for changes kept outside the drawing's JSON (see HISTORY above).
function commit(change) {
  normalizeGroups(doc);   // every change passes through here, so groups always stay tidy
  const s = docJSON(doc);   // without derived outlines; loadSnapshot rebuilds them
  const cur = hist.steps[hist.idx];
  if (!cur || cur.json !== s || change) {
    hist.steps.splice(hist.idx + 1).forEach(dropStep);   // a new change ends the redo trail
    const st = { json: s, ids: docImageIds(doc), change };
    hist.steps.push(st); hist.bytes += stepBytes(st);
    while (hist.steps.length > 2 && (hist.steps.length > HISTORY.steps || hist.bytes > HISTORY.bytes)) dropStep(hist.steps.shift());
    hist.idx = hist.steps.length - 1;
    scheduleSave(s);
  }
  refreshAll();
}
function loadSnapshot(str) {
  doc = JSON.parse(str);
  if (!Array.isArray(doc.groups)) doc.groups = [];   // snapshots from before groups existed
  rebuildOutlines(doc);
  S.sel = new Set(Array.from(S.sel).filter(id => byId(id)));
  refreshAll();
}
const canUndo = () => hist.idx > 0, canRedo = () => hist.idx < hist.steps.length - 1;
function undo() {
  if (psnBusy || eraseBusy() || !canUndo()) return;
  const st = hist.steps[hist.idx];
  if (st.change && st.change.undo) st.change.undo();
  hist.idx--; loadSnapshot(hist.steps[hist.idx].json); scheduleSave(hist.steps[hist.idx].json);
}
function redo() {
  if (psnBusy || eraseBusy() || !canRedo()) return;
  hist.idx++;
  const st = hist.steps[hist.idx];
  loadSnapshot(st.json);
  if (st.change && st.change.redo) st.change.redo();
  scheduleSave(st.json);
}
function revertUncommitted() { if (hist.idx >= 0) loadSnapshot(hist.steps[hist.idx].json); }
function resetHistory() { hist.steps.forEach(dropStep); hist.steps = []; hist.idx = -1; hist.bytes = 0; commit(); }

