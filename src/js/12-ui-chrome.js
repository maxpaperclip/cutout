/* =====================================================================
   Toast, menus, panel
   ===================================================================== */
let toastTimer = null;
function toast(msg, ms) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms || 3200);
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

