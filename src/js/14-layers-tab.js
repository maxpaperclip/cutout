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
