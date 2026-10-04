/* =====================================================================
   Global UI wiring
   ===================================================================== */
function refreshAll() {
  warmPaintHits();
  drawArtboard(); syncObjects(); drawOverlay(); renderLayers(); updateInspector(); updatePageTab(); updateEmpty();
  $('#btn-undo').disabled = !canUndo(); $('#btn-redo').disabled = !canRedo();
}
function render() { syncObjects(); drawOverlay(); updateInspector(); }

$$('.tool[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$$('.tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
$('#persp-done').addEventListener('click', () => { setTool('select'); refreshAll(); });
$('#path-done').addEventListener('click', () => { if (pe) exitPointEdit(); else if (pen && pen.pts.length >= 2) penFinish(false); });
$('#persp-reset').addEventListener('click', perspReset);
$('#btn-undo').addEventListener('click', undo);
$('#btn-redo').addEventListener('click', redo);
$('#z-in').addEventListener('click', () => zoomCenter(1.25));
$('#z-out').addEventListener('click', () => zoomCenter(0.8));
$('#z-fit').addEventListener('click', () => { userView = false; fit(); });
$('#z-label').addEventListener('click', () => { userView = true; const s = stageSize(); zoomAt(1 / view.z, s.w / 2, s.h / 2); });
$('#btn-panel').addEventListener('click', () => { $('#panel').classList.toggle('open'); updateInspector(); });
$('#btn-file').addEventListener('click', e => { e.stopPropagation(); const m = $('#menu-file'); m.hidden = !m.hidden; $('#btn-file').setAttribute('aria-expanded', String(!m.hidden)); });
document.addEventListener('click', e => { if (!e.target.closest('.menuwrap')) closeMenus(); });
document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]'); if (!a || a.closest('#layers')) return;
  const act = a.dataset.act;
  if (act === 'new') newDrawing(); else if (act === 'open') { closeMenus(); $('#file-project').click(); }
  else if (act === 'save') saveProject(); else if (act === 'example') loadExample(); else if (act === 'resume') reopenLast();
  else if (act === 'import') { closeMenus(); $('#file-photo').click(); }
});
$('#file-photo').addEventListener('change', e => { const f = e.target.files; const list = Array.from(f); e.target.value = ''; importFiles(list); });
const dropZone = $('#stagewrap');
const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0;
['dragenter', 'dragover'].forEach(t => dropZone.addEventListener(t, e => { if (hasFiles(e)) { e.preventDefault(); dropZone.classList.add('dropping'); } }));
dropZone.addEventListener('dragleave', e => { if (e.target === dropZone || !dropZone.contains(e.relatedTarget)) dropZone.classList.remove('dropping'); });
dropZone.addEventListener('drop', e => { dropZone.classList.remove('dropping'); if (!hasFiles(e)) return; e.preventDefault(); importFiles(Array.from(e.dataTransfer.files)); });
$('#file-project').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) openProject(f); });

const isTyping = e => { const t = e.target; return t && (t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'range' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
window.addEventListener('keydown', e => {
  if (psnBusy) { e.preventDefault(); return; }
  if (!$('#export-overlay').hidden) { if (e.key === 'Escape') closeExport(); return; }
  if (isTyping(e)) return;
  const t = tool();
  if (t.keys && t.keys(e)) return;   // keys the current tool uses (the pen and point editing use Enter, Esc, Delete, the arrows)
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (e.code === 'Space' && !e.target.closest('button')) { if (!spaceDown) { spaceDown = true; stage.classList.add('panning'); } e.preventDefault(); return; }
  if (mod) {
    if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (k === 'y') { e.preventDefault(); redo(); }
    else if (k === 'd') { e.preventDefault(); duplicateSelected(); }
    else if (k === 'g') { e.preventDefault(); e.shiftKey ? ungroupSelected() : groupSelected(); }
    else if (k === 'a') { e.preventDefault(); selectAll(); }
    else if ((k === 'b' || k === 'i') && one() && one().kind === 'text') { e.preventDefault(); toggleStyle(k === 'b' ? 'bold' : 'italic', true); }   // bold and italic for the selected text (13b-font-picker.js)
    else if (k === 'c') { copySelected(); }
    else if (k === 'v') { pasteClipboard(); }
    return;
  }
  if (e.shiftKey && (k === 'h' || k === 'v')) { e.preventDefault(); mirrorSelected(k); return; }
  const byKey = Object.keys(TOOLS).find(n => TOOLS[n].key === k);   // each tool's own shortcut
  if (byKey) { setTool(byKey); e.preventDefault(); return; }
  if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSelected(); }
  else if (k === 'escape') { S.sel = new Set(); setTool('select'); refreshAll(); }
  else if (k.startsWith('arrow')) {
    const st = e.shiftKey ? 10 : 1;
    e.preventDefault(); nudge(k === 'arrowleft' ? -st : k === 'arrowright' ? st : 0, k === 'arrowup' ? -st : k === 'arrowdown' ? st : 0);
  }
  else if (k === ']') orderSelected('forward');
  else if (k === '[') orderSelected('backward');
  else if (k === '=' || k === '+') zoomCenter(1.25);
  else if (k === '-') zoomCenter(0.8);
  else if (k === '0') { userView = false; fit(); }
});
window.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; if (!drag) stage.classList.remove('panning'); } });
window.addEventListener('blur', () => { spaceDown = false; });
window.addEventListener('resize', () => { drawOverlay(); });
document.addEventListener('gesturestart', e => e.preventDefault());

