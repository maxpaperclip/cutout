/* =====================================================================
   Boot
   ===================================================================== */
$('#font-credits-list').textContent = FONT_CATEGORIES.filter(c => c[0] !== 'user').map(([c, name]) => name + ': ' + Object.values(FAMILIES).filter(F => F.category === c).map(F => F.label).join(', ')).join('. ') + '.';
setTool('select');
$('#about-ver').textContent = 'Cutout v' + APP_VERSION;
if (window.ResizeObserver) new ResizeObserver(() => { if (!userView) fit(); else drawOverlay(); }).observe($('#stagewrap'));
(async function boot() {
  let restored = null;
  try { restored = await Promise.race([restoreSession(), new Promise(r => setTimeout(() => r(null), 6000))]); } catch (e) { restored = null; }
  let note = '';
  if (restored && restored.doc.objects.length && !doc.objects.length) {
    doc = restored.doc;
    note = restored.lost ? 'Restored your last drawing. Some photos could not be restored.' : 'Restored your last drawing.';
  }
  suppressSave = true; resetHistory(); suppressSave = false;
  requestAnimationFrame(() => { fit(); if (note) toast(note); });
  cleanOrphans();
})();


})();

