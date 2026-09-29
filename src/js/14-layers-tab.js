/* =====================================================================
   Layers tab
   Shows the drawing top first, with each group as a folder that opens to show what is inside
   (see 04b-groups.js). Which folders are open is remembered here, not in the drawing, so opening
   a folder isn't something Undo steps through.
   ===================================================================== */
const layersBox = $('#layers');
let layerSig = '';
const layerOpen = new Set();   // ids of the folders that are open
// Open the folders around an object, so it can be seen in the list
function revealInLayers(o) { ancestorsOf(doc, o).forEach(g => layerOpen.add(g.id)); }

function layerRow(item, depth, isGroup, leaves) {
  const hidden = effHidden(doc, item);   // hidden itself, or inside a hidden group
  const label = isGroup ? groupLabel(item) : labelOf(item);
  const row = elt('div', 'layer' + (isGroup ? ' grp' : '') + (hidden ? ' off' : ''));
  row.dataset.id = item.id; row.dataset.kind = isGroup ? 'g' : 'o';
  row.style.setProperty('--depth', depth);
  if (isGroup) {
    const open = layerOpen.has(item.id);
    const tw = elt('button', 'twisty'); tw.dataset.act = 'twisty';
    tw.setAttribute('aria-expanded', open ? 'true' : 'false');
    tw.setAttribute('aria-label', (open ? 'Close ' : 'Open ') + label);
    tw.innerHTML = '<span class="ico">' + icon('chev') + '</span>';
    row.appendChild(tw);
  } else row.appendChild(elt('span', 'twisty-gap'));
  const cb = elt('input'); cb.type = 'checkbox'; cb.dataset.act = 'pick'; cb.setAttribute('aria-label', 'Select ' + label);
  const ic = elt('span', 'kico'); ic.innerHTML = icon(isGroup ? 'folder' : iconFor(item));
  const nm = elt('span', 'lname', label); nm.dataset.act = 'name';
  nm.title = isGroup ? 'Click to select the whole group, double-click to rename' : 'Click to select, double-click to rename';
  if (isGroup) nm.appendChild(elt('small', 'lcount', String(leaves)));
  const eye = elt('button', 'btn icon'); eye.dataset.act = 'eye'; eye.title = item.hidden ? 'Show' : 'Hide'; eye.setAttribute('aria-label', eye.title + ' ' + label); eye.innerHTML = '<span class="ico">' + icon(item.hidden ? 'eyeoff' : 'eye') + '</span>';
  const lk = elt('button', 'btn icon'); lk.dataset.act = 'lock'; lk.title = item.locked ? 'Unlock' : 'Lock'; lk.setAttribute('aria-label', lk.title + ' ' + label); lk.innerHTML = '<span class="ico">' + icon(item.locked ? 'lock' : 'unlock') + '</span>';
  row.append(cb, ic, nm, eye, lk);
  return row;
}
// Show which rows are selected. A folder is ticked when everything in it is selected, and
// half-ticked when only some of it is.
function markLayerSelection() {
  $$('.layer', layersBox).forEach(row => {
    const id = +row.dataset.id, cb = row.querySelector('input[type=checkbox]');
    let on = false, some = false;
    if (row.dataset.kind === 'g') {
      const l = groupLeaves(doc, id), n = l.filter(o => S.sel.has(o.id)).length;
      on = l.length > 0 && n === l.length; some = n > 0 && !on;
    } else on = S.sel.has(id);
    row.classList.toggle('sel', on); row.classList.toggle('part', some);
    cb.checked = on; cb.indeterminate = some;
  });
}
function renderLayers() {
  // Only rebuild rows when the list itself changed; otherwise just update the selection in place
  const sig = doc.objects.map(o => o.id + '|' + labelOf(o) + '|' + (o.hidden ? 1 : 0) + (o.locked ? 1 : 0) + '|' + iconFor(o) + '|' + (o.parent || '')).join('\n') +
    '#' + doc.groups.map(g => g.id + '|' + g.name + '|' + (g.hidden ? 1 : 0) + (g.locked ? 1 : 0) + '|' + g.parent).join('\n') + '#' + [...layerOpen].join(',');
  if (sig === layerSig && layersBox.children.length) { markLayerSelection(); return; }
  layerSig = sig;
  layersBox.textContent = '';
  if (!doc.objects.length) { layersBox.appendChild(elt('p', 'hint', 'Nothing on the page yet.')); return; }
  const tree = buildTree(doc);
  (function add(nodes, depth) {
    nodes.forEach(n => {
      if (n.o) { layersBox.appendChild(layerRow(n.o, depth, false)); return; }
      layersBox.appendChild(layerRow(n.g, depth, true, nodeLeaves(n).length));
      if (layerOpen.has(n.g.id)) add(n.children, depth + 1);
    });
  })(tree.children, 0);
  layersBox.appendChild(elt('p', 'help layer-tip', 'Drag a row to change the order, or onto a folder to put it inside. On a touch screen, press and hold first.'));
  markLayerSelection();
}
layersBox.addEventListener('click', e => {
  const row = e.target.closest('.layer'); if (!row) return;
  const id = +row.dataset.id, isGroup = row.dataset.kind === 'g';
  const item = isGroup ? groupById(doc, id) : byId(id); if (!item) return;
  const actEl = e.target.closest('[data-act]'), act = actEl ? actEl.dataset.act : 'name';
  const ids = isGroup ? groupLeaves(doc, id).map(o => o.id) : [id];
  const toggle = () => { const all = ids.every(x => S.sel.has(x)); ids.forEach(x => all ? S.sel.delete(x) : S.sel.add(x)); };
  if (act === 'twisty') { if (layerOpen.has(id)) layerOpen.delete(id); else layerOpen.add(id); renderLayers(); return; }
  if (act === 'eye') { item.hidden = !item.hidden; if (item.hidden) ids.forEach(x => S.sel.delete(x)); commit(); }
  else if (act === 'lock') { item.locked = !item.locked; commit(); }
  else if (act === 'pick' || e.shiftKey || e.metaKey || e.ctrlKey) { toggle(); refreshAll(); }
  else { S.sel = new Set(ids); refreshAll(); }
});
layersBox.addEventListener('dblclick', e => {
  const nm = e.target.closest('.lname'); if (!nm) return;
  const row = nm.closest('.layer'), isGroup = row.dataset.kind === 'g';
  const item = isGroup ? groupById(doc, +row.dataset.id) : byId(+row.dataset.id); if (!item) return;
  const inp = elt('input', 'lname-in'); inp.type = 'text'; inp.value = isGroup ? groupLabel(item) : labelOf(item); inp.maxLength = 60;
  inp.setAttribute('aria-label', 'Name');
  nm.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = ok => { if (done) return; done = true; if (ok) { item.name = inp.value.trim(); commit(); } else renderLayers(); };
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') finish(true); else if (ev.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
});

/* ---------- dragging rows to change the order ----------
   Drag a row up or down the list to move it in the stacking order. A line shows where it will
   land; over the middle of a folder, the folder lights up and the row goes inside it (on top).
   Dragging a selected row moves everything selected with it. With a mouse or pen the drag starts
   as soon as the row moves; with a finger, press and hold first, so a normal swipe still scrolls
   the list. Esc cancels. (The Up / Down / Front / Back buttons do the same job from the keyboard.) */
let rowDrag = null, skipClick = false;
const dropClasses = ['drop-above', 'drop-below', 'drop-into'];
const layersScroller = () => layersBox.closest('.pane') || layersBox;
function clearDropMarks() { $$('.layer', layersBox).forEach(r => r.classList.remove(...dropClasses)); }
function endRowDrag() {
  const d = rowDrag; rowDrag = null;
  if (!d) return;
  clearTimeout(d.timer); cancelAnimationFrame(d.raf);
  layersBox.classList.remove('dragging');
  $$('.layer.dragged', layersBox).forEach(r => r.classList.remove('dragged'));
  clearDropMarks();
  try { layersBox.releasePointerCapture(d.pid); } catch (_) { /* ignore */ }
}
function startRowDrag() {
  const d = rowDrag;
  d.active = true;
  // Moving a selected row moves the whole selection; otherwise just this row
  const item = d.kind === 'g' ? groupById(doc, d.id) : byId(d.id);
  const leaves = d.kind === 'g' ? groupLeaves(doc, d.id) : [item];
  const picked = leaves.length && leaves.every(o => S.sel.has(o.id));
  d.ids = picked ? new Set(selectionUnits(doc, S.sel).map(u => u.o ? u.o.id : u.g.id)) : new Set([d.id]);
  layersBox.classList.add('dragging');
  $$('.layer', layersBox).forEach(r => { if (d.ids.has(+r.dataset.id)) r.classList.add('dragged'); });
  try { layersBox.setPointerCapture(d.pid); } catch (_) { /* ignore */ }
  if (navigator.vibrate && d.touch) navigator.vibrate(10);
  autoScroll();
}
// Scroll the list while the pointer is held near its top or bottom edge
function autoScroll() {
  const d = rowDrag; if (!d || !d.active) return;
  const sc = layersScroller(), r = sc.getBoundingClientRect(), edge = 36;
  if (d.y !== undefined) {
    const v = d.y < r.top + edge ? -(r.top + edge - d.y) / 3 : d.y > r.bottom - edge ? (d.y - (r.bottom - edge)) / 3 : 0;
    if (v) { sc.scrollTop += clamp(v, -14, 14); markDrop(d.y); }
  }
  d.raf = requestAnimationFrame(autoScroll);
}
// Work out where a drop at height y would go, and show it
function markDrop(y) {
  const d = rowDrag, rows = $$('.layer', layersBox);
  clearDropMarks(); d.drop = null;
  if (!rows.length) return;
  let row = rows.find(r => { const b = r.getBoundingClientRect(); return y >= b.top && y < b.bottom; });
  let place;
  if (!row) {
    const first = rows[0].getBoundingClientRect();
    row = y < first.top ? rows[0] : rows[rows.length - 1];
    place = y < first.top ? 'above' : 'below';
  } else {
    const b = row.getBoundingClientRect(), rel = (y - b.top) / b.height, isGroup = row.dataset.kind === 'g';
    place = isGroup ? (rel < 0.28 ? 'above' : rel > 0.72 ? 'below' : 'into') : (rel < 0.5 ? 'above' : 'below');
    if (isGroup && place === 'below' && layerOpen.has(+row.dataset.id)) place = 'into';   // just under an open folder is its top
  }
  const tid = +row.dataset.id;
  // nowhere inside what is being dragged
  const blocked = d.ids.has(tid) || [...d.ids].some(id => {
    const tgt = row.dataset.kind === 'g' ? groupById(doc, tid) : byId(tid);
    return tgt && groupById(doc, id) && ancestorsOf(doc, tgt).some(g => g.id === id);
  });
  if (blocked) return;
  row.classList.add('drop-' + place);
  d.drop = { id: tid, place };
}
layersBox.addEventListener('pointerdown', e => {
  if (e.button > 0 || rowDrag) return;
  const row = e.target.closest('.layer');
  if (!row || e.target.closest('button, input')) return;   // the arrow, tick box, eye, lock and rename field keep their own jobs
  rowDrag = { id: +row.dataset.id, kind: row.dataset.kind, x0: e.clientX, y0: e.clientY, pid: e.pointerId, touch: e.pointerType === 'touch', active: false };
  if (rowDrag.touch) rowDrag.timer = setTimeout(() => { if (rowDrag && !rowDrag.active) { startRowDrag(); markDrop(rowDrag.y0); } }, 380);
});
window.addEventListener('pointermove', e => {
  const d = rowDrag; if (!d || e.pointerId !== d.pid) return;
  if (!d.active) {
    const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
    if (d.touch) { if (dist > 8) endRowDrag(); return; }   // a finger that moves first is scrolling the list
    if (dist < 5) return;
    startRowDrag();
  }
  d.y = e.clientY;
  markDrop(e.clientY);
});
// While a finger is dragging a row, stop the list from scrolling under it
layersBox.addEventListener('touchmove', e => { if (rowDrag && rowDrag.active) e.preventDefault(); }, { passive: false });
function finishRowDrag(e) {
  const d = rowDrag; if (!d || (e && e.pointerId !== d.pid)) return;
  const drop = d.active && e && e.type === 'pointerup' ? d.drop : null, ids = d.ids, was = d.active;
  endRowDrag();
  if (was) { skipClick = true; setTimeout(() => { skipClick = false; }, 0); }
  if (drop && moveUnitsTo(doc, ids, drop.id, drop.place)) {
    if (drop.place === 'into') layerOpen.add(drop.id);
    commit();
  }
}
window.addEventListener('pointerup', finishRowDrag);
window.addEventListener('pointercancel', finishRowDrag);
window.addEventListener('keydown', e => {
  if (rowDrag && rowDrag.active && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); endRowDrag(); }
});
// A drag ends with a click on the row it started from; that click shouldn't change the selection
layersBox.addEventListener('click', e => { if (skipClick) { e.stopImmediatePropagation(); skipClick = false; } }, true);
