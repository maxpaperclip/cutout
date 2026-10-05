/* =====================================================================
   Toast, menus, panel
   ===================================================================== */
let toastTimer = null;
function toast(msg, ms) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms || 3200);
}
/* ---------- a newer version exists ----------
   A browser (or a host) may keep showing a page it already has, so a plain refresh can bring back the old version. The hosted site
   publishes version.json next to the page (build.js); a page that finds a different version there offers to reload,
   asking the server for the page again instead of reusing the stored copy. Only for the hosted site: a file opened from a folder is read afresh. */
let updateChecked = 0;
async function checkForUpdate() {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  if (Date.now() - updateChecked < 60000) return;
  updateChecked = Date.now();
  try {
    const r = await fetch(new URL('version.json', location.href).href + '?' + Date.now(), { cache: 'no-store' });
    const v = r.ok ? (await r.json()).version : null;
    if (typeof v === 'string' && v !== APP_VERSION) { $('#update-ver').textContent = 'v' + v; $('#update-bar').hidden = false; }
  } catch (e) { /* offline, or no version.json: nothing to say */ }
}
async function reloadFresh() {
  try { await fetch(location.href, { cache: 'reload' }); } catch (e) { /* reload anyway */ }   // replaces the stored copy of the page
  location.reload();
}
function closeMenus() { $('#menu-file').hidden = true; $('#btn-file').setAttribute('aria-expanded', 'false'); }
function openPanel() { $('#panel').classList.add('open'); $('#btn-panel').setAttribute('aria-pressed', 'true'); }
function switchTab(name) {
  $$('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false'));
  $$('.pane').forEach(p => { p.hidden = p.dataset.pane !== name; });
  if (name === 'page') updatePhotoInfo();
}
function updateEmpty() {
  $('#empty').hidden = !(doc.objects.length === 0 && S.tool === 'select');
  $('#empty-resume').hidden = !held;
  if (held) { const n = held.doc.objects.length; $('#empty-resume-info').textContent = 'Your last drawing is still saved here (' + n + (n === 1 ? ' object' : ' objects') + ').'; }
}
// Open the drawing that was kept from last time
function reopenLast() {
  if (!held || doc.objects.length) return;
  const h = held; held = null;
  doc = h.doc;
  suppressSave = true; resetHistory(); suppressSave = false;
  requestAnimationFrame(() => fit());
  toast(h.lost ? 'Reopened your last drawing. Some photos could not be restored.' : 'Reopened your last drawing.');
}

