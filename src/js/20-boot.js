/* =====================================================================
   Boot
   ===================================================================== */
// What is new in this build, said once when a different version opens (and kept in About). Rewrite it for each release.
const WHATS_NEW = 'Columns, continued: in a text with columns, a paragraph can now span all the columns (a heading, say), with the columns above and below it balanced on their own, or start at the top of the next column. Both are in the Paragraph part of the Design tab.';
const SEEN_KEY = 'friendshaped.seen';
$('#font-credits-list').textContent = FONT_CATEGORIES.filter(c => c[0] !== 'user').map(([c, name]) => name + ': ' + Object.values(FAMILIES).filter(F => F.category === c).map(F => F.label).join(', ')).join('. ') + '.';
setTool('select');
$('#about-ver').textContent = 'FriendShaped v' + APP_VERSION;
$('#about-new').textContent = WHATS_NEW;
$('#resume-pref').value = resumePref();
$('#resume-pref').addEventListener('change', e => { try { localStorage.setItem(RESUME_KEY, e.target.value); } catch (err) { toast('This browser would not keep that setting.'); } });
if (window.ResizeObserver) new ResizeObserver(() => { if (!userView) fit(); else drawOverlay(); }).observe($('#stagewrap'));
(async function boot() {
  const pref = resumePref();
  let restored = null;
  try { restored = await Promise.race([restoreSession(pref !== 'new'), new Promise(r => setTimeout(() => r(null), 6000))]); } catch (e) { restored = null; }
  let note = '';
  if (restored && restored.doc.objects.length && !doc.objects.length) {
    if (pref === 'open') {
      doc = restored.doc;
      note = restored.lost ? 'Restored your last drawing. Some photos could not be restored.' : 'Restored your last drawing.';
    } else held = restored;   // 'ask': a blank page, with a button to bring it back (updateEmpty)
  }
  suppressSave = true; resetHistory(); suppressSave = false;
  // A different version than last time: say so, and what changed, so an updated file is easy to recognize
  let updated = false;
  try { const seen = localStorage.getItem(SEEN_KEY); updated = !!seen && seen !== APP_VERSION; localStorage.setItem(SEEN_KEY, APP_VERSION); } catch (e) { /* no memory of versions in this browser */ }
  if (updated) note = ('Updated to v' + APP_VERSION + '. ' + WHATS_NEW + ' ' + note).trim();
  requestAnimationFrame(() => { fit(); if (note) toast(note, updated ? 9000 : 3200); });
  checkForUpdate();
  if (!held) cleanOrphans();   // (the photos of a drawing still waiting to be reopened are kept)
})();


})();
